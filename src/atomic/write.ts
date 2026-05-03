import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

const MODE_OWNER_RW = 0o600;
const ORPHAN_TEMP_AGE_MS = 30_000;

/**
 * Write `payload` to `targetPath` atomically.
 *
 * Implements NFR-004 (mode 0600, atomic temp+rename) and the FR-010
 * filesystem failure modes:
 *
 * - The temp file is a sibling of the target so the rename is on the same
 *   volume on every platform (FR-010-AC-8). Never use `os.tmpdir()`.
 * - Mode is 0o600 regardless of process umask (NFR-004-AC-1).
 * - Symlinks at `targetPath` are refused (NFR-004-AC-4).
 * - Read-only / out-of-space targets raise `ConfigWriteError` and leave
 *   prior content intact (FR-010-AC-7).
 * - On any failure path, the temp file is removed.
 */
export function atomicWrite(targetPath: string, payload: string | Uint8Array): void {
  refuseSymlink(targetPath);
  pruneOrphanTemps(targetPath);

  const tempPath = `${targetPath}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  let fd: number | undefined;

  try {
    // O_CREAT | O_EXCL | O_WRONLY, mode 0600 — fails if temp file already exists,
    // bypasses umask via explicit mode argument.
    fd = openSync(tempPath, "wx", MODE_OWNER_RW);
    const bytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
    writeSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    renameSync(tempPath, targetPath);
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed; ignore
      }
    }
    try {
      unlinkSync(tempPath);
    } catch {
      // temp may not exist if openSync failed; ignore
    }
    throw new ConfigWriteError(targetPath, err as NodeJS.ErrnoException);
  }
}

/**
 * Refuse to operate on a symlinked target — prevents permission-laundering
 * via a symlink to a different file. Implements NFR-004-AC-4.
 */
function refuseSymlink(path: string): void {
  let st;
  try {
    st = lstatSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new ConfigSymlinkRefusedError(path);
  }
}

/**
 * Prune sibling `<target>.tmp.*` orphans older than ORPHAN_TEMP_AGE_MS.
 * Implements FR-010-AC-9. Younger orphans are left alone — another writer
 * may be mid-flight.
 */
function pruneOrphanTemps(targetPath: string): void {
  const dir = dirname(targetPath);
  const base = targetPath.slice(dir.length + 1);
  const prefix = `${base}.tmp.`;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  const cutoff = Date.now() - ORPHAN_TEMP_AGE_MS;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoff) {
        unlinkSync(full);
      }
    } catch {
      // race with another writer; skip
    }
  }
}

export class ConfigWriteError extends Error {
  readonly path: string;
  readonly errno?: string;
  constructor(path: string, cause: NodeJS.ErrnoException) {
    const remediation = remediationHint(cause.code);
    super(
      `failed to write ${path}: ${cause.message}${remediation ? ` — ${remediation}` : ""}`,
    );
    this.name = "ConfigWriteError";
    this.path = path;
    this.errno = cause.code;
    this.cause = cause;
  }
}

export class ConfigSymlinkRefusedError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(
      `refusing to write through symlink at ${path} — remove the symlink and re-run`,
    );
    this.name = "ConfigSymlinkRefusedError";
    this.path = path;
  }
}

function remediationHint(code: string | undefined): string | undefined {
  switch (code) {
    case "EACCES":
    case "EPERM":
      return "check directory permissions";
    case "EROFS":
      return "target filesystem is read-only";
    case "ENOSPC":
      return "no space left on device";
    case "EISDIR":
      return "path is a directory, not a file";
    default:
      return undefined;
  }
}
