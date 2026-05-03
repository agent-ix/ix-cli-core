import {
  closeSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_MS = 50;
const STALE_LOCK_AGE_MS = 30_000;

export interface FileLockOptions {
  timeoutMs?: number;
  retryMs?: number;
}

/**
 * Acquire an advisory lock at `lockPath`, run `fn`, and release the lock.
 *
 * Implements FR-011-AC-4 (same-plugin concurrent writes serialized),
 * FR-011-AC-6 (stale lock from non-running pid reaped), and FR-011-AC-7
 * (timeout → ConfigLockTimeoutError).
 *
 * The lock is created with `O_CREAT | O_EXCL | O_WRONLY` and contains the
 * acquiring process's pid so stale locks can be reaped when the holder
 * is no longer running.
 */
export function withFileLock<T>(
  lockPath: string,
  fn: () => T,
  opts: FileLockOptions = {},
): T {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryMs = opts.retryMs ?? DEFAULT_RETRY_MS;
  const deadline = Date.now() + timeoutMs;

  acquireLockOrThrow(lockPath, deadline, retryMs);
  try {
    return fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // already gone — fine
    }
  }
}

function acquireLockOrThrow(
  lockPath: string,
  deadline: number,
  retryMs: number,
): void {
  // First attempt — common case: no existing lock.
  if (tryCreateLock(lockPath)) return;

  while (true) {
    if (tryReapStaleLock(lockPath) && tryCreateLock(lockPath)) return;
    if (Date.now() >= deadline) {
      throw new ConfigLockTimeoutError(lockPath);
    }
    sleepSync(retryMs);
    if (tryCreateLock(lockPath)) return;
  }
}

function tryCreateLock(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    writeSync(fd, `${process.pid}\n`);
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === "EEXIST") return false;
    throw err;
  }
}

function tryReapStaleLock(lockPath: string): boolean {
  let st;
  try {
    st = statSync(lockPath);
  } catch (err) {
    return (err as { code?: string }).code === "ENOENT";
  }
  const age = Date.now() - st.mtimeMs;
  if (age < STALE_LOCK_AGE_MS) return false;

  // Lock is old. Inspect pid; remove if its holder is no longer running.
  let pid: number | undefined;
  try {
    const txt = readFileSync(lockPath, "utf8").trim();
    const n = Number.parseInt(txt, 10);
    if (Number.isFinite(n) && n > 0) pid = n;
  } catch {
    // Unreadable — treat as stale.
  }
  if (pid === undefined || !isProcessRunning(pid)) {
    try {
      unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but we can't signal it.
    return (err as { code?: string }).code !== "ESRCH";
  }
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  // Atomics.wait blocks the current thread without spinning; perfect for
  // a tiny back-off in synchronous code.
  Atomics.wait(view, 0, 0, ms);
}

export class ConfigLockTimeoutError extends Error {
  readonly lockPath: string;
  constructor(lockPath: string) {
    super(
      `timed out waiting for advisory lock at ${lockPath} — another ix process is writing the same plugin's config`,
    );
    this.name = "ConfigLockTimeoutError";
    this.lockPath = lockPath;
  }
}
