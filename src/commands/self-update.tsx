import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type * as IxUiCli from "@agent-ix/ix-ui-cli";

import { cacheRoot } from "../config/paths.js";
import { defaultConfirm } from "../runtime/agent.js";

let _ixUi: typeof IxUiCli | undefined;
async function loadIxUi(): Promise<typeof IxUiCli> {
  return (_ixUi ??= await import("@agent-ix/ix-ui-cli"));
}

export interface SelfUpdateOptions {
  /** npm package name to upgrade, e.g. `@agent-ix/quoin`. */
  packageName: string;
  /** Currently-running version (typically read from the caller's package.json). */
  currentVersion: string;
  /** Listing header, e.g. `quoin update`. Defaults to `<packageName> update`. */
  header?: string;
  /**
   * Override the npm registry. When omitted, the ambient npm config is used —
   * i.e. however the user originally installed the package (their
   * `@scope:registry` setting, or the npm default). Pass a URL (e.g.
   * `https://registry.npmjs.org/` or `http://npm.ix/`) to force one.
   */
  registry?: string;
  /** Check for an update without installing. */
  check?: boolean;
}

export interface SelfUpdateResult {
  /** True when an install was performed (false for up-to-date or `check`). */
  updated: boolean;
  /** The latest version reported by the registry. */
  latest: string;
}

/**
 * npm flags that force `registry` for `packageName`. A plain `--registry` is
 * silently ignored for a scoped package when the user's npmrc pins a
 * `@scope:registry`; the scope-specific override is the one npm actually
 * honors. Returns an empty array when no override is requested (ambient
 * config resolves the package).
 */
function registryArgs(packageName: string, registry?: string): string[] {
  if (!registry) return [];
  const scope = packageName.startsWith("@")
    ? packageName.split("/")[0]
    : undefined;
  return scope ? [`--${scope}:registry=${registry}`] : ["--registry", registry];
}

/** Spawn a command, capturing stdout. Rejects on non-zero exit, surfacing the
 * child's stderr (npm's real error — auth, 404 — rather than a bare code). */
function spawnCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const proc = spawn(cmd, args, { shell: false });
    proc.stdout?.on("data", (d: Buffer) => out.push(d));
    proc.stderr?.on("data", (d: Buffer) => err.push(d));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString().trim());
      } else {
        const detail = Buffer.concat(err).toString().trim();
        reject(
          new Error(
            `${cmd} exited with code ${String(code)}${detail ? `: ${detail}` : ""}`,
          ),
        );
      }
    });
    proc.on("error", reject);
  });
}

/** Spawn a command with inherited stdio (lets npm draw its own progress). */
function spawnInherited(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit", shell: false });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${String(code)}`));
    });
    proc.on("error", reject);
  });
}

/**
 * Generic self-update for an npm-distributed IX CLI: query the registry for the
 * latest published version, compare to the running version, and (unless
 * `check`) `npm install -g <pkg>@<latest>`. Rendering of the result listing is
 * done here so every CLI gets identical output; the resolved
 * {@link SelfUpdateResult} is also returned for callers that want to branch.
 *
 * This is framework-agnostic: it has no oclif dependency and is callable from a
 * plain command dispatcher (e.g. quoin) as easily as from a BaseCommand.
 */
export async function runSelfUpdate(
  opts: SelfUpdateOptions,
): Promise<SelfUpdateResult> {
  const { FlowLine, Listing, Note, blue, colors, renderStatic } =
    await loadIxUi();

  const header = opts.header ?? `${opts.packageName} update`;
  const current = opts.currentVersion;
  const regArgs = registryArgs(opts.packageName, opts.registry);
  const registryLabel = opts.registry ?? "npm config (ambient)";

  const baseNotes = (
    <>
      <Note>{`registry ${blue(registryLabel)}`}</Note>
      <Note>{`current  ${blue(current)}`}</Note>
    </>
  );

  let latest: string;
  try {
    latest = await spawnCapture("npm", [
      "view",
      opts.packageName,
      "version",
      ...regArgs,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={header}
        status="failed"
        tail={`Could not reach registry: ${msg}`}
        tailVariant="error"
      >
        {baseNotes}
      </Listing>,
    );
    throw err;
  }

  if (current === latest) {
    await renderStatic(
      <Listing
        header={header}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`${blue(current)} from ${blue(registryLabel)}`}</FlowLine>
        }
        tail={`Already up to date · ${blue(latest)}`}
      />,
    );
    return { updated: false, latest };
  }

  if (opts.check) {
    await renderStatic(
      <Listing
        header={header}
        status="passed"
        variant="flow"
        pre={
          <FlowLine>{`${blue(current)} from ${blue(registryLabel)}`}</FlowLine>
        }
        tail={`Update available · ${blue(latest)}`}
        tailVariant="warn"
      />,
    );
    return { updated: false, latest };
  }

  // `npm install -g` writes its own progress to stdout — let it inherit, then
  // render a final summary listing.
  try {
    await spawnInherited("npm", [
      "install",
      "-g",
      `${opts.packageName}@${latest}`,
      ...regArgs,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await renderStatic(
      <Listing
        header={header}
        status="failed"
        tail={`Install failed: ${msg}`}
        tailVariant="error"
      >
        {baseNotes}
        <Note>{`latest   ${blue(latest)}`}</Note>
      </Listing>,
    );
    throw err;
  }

  await renderStatic(
    <Listing
      header={header}
      status="passed"
      variant="flow"
      pre={
        <FlowLine>{`${colors.dim(current)} → ${blue(latest)} via ${blue(registryLabel)}`}</FlowLine>
      }
      tail={`Updated to ${blue(latest)}.`}
    />,
  );
  return { updated: true, latest };
}

// ── Update notifier ────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateNotifierOptions {
  /** npm package name, e.g. `@agent-ix/quoin`. */
  packageName: string;
  /** Currently-running version. */
  currentVersion: string;
  /** Registry override; defaults like {@link runSelfUpdate} to the ambient config. */
  registry?: string;
  /** Whether to prompt. Default: stdin and stdout are both TTYs. */
  interactive?: boolean;
  /** Throttle window between registry checks. Default 24h. */
  ttlMs?: number;
  /** Cache file path. Default `<cacheRoot>/update-check.json`. */
  cachePath?: string;
  /** Clock injection for tests. Default `Date.now`. */
  now?: () => number;
  /** Environment injection for tests. Default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** `[Y/n]` confirm (Enter = yes). Default {@link defaultConfirm}. */
  confirm?: (question: string) => boolean;
}

export interface UpdateNotifierResult {
  /** True when the registry was actually queried this run. */
  checked: boolean;
  /** Why the check was skipped, when `checked` is false. */
  reason?: "ci" | "opted-out" | "non-interactive" | "throttled" | "error";
  /** Latest published version, when checked. */
  latest?: string;
  /** True when `latest` is newer than the running version. */
  updateAvailable?: boolean;
  /** True when the user accepted and the install succeeded. */
  updated?: boolean;
}

interface UpdateCacheEntry {
  lastCheck: number;
  latest: string;
}
type UpdateCache = Record<string, UpdateCacheEntry>;

function parseCore(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is strictly newer than `current` by numeric major.minor.patch.
 * Pre-release/`-dirty` suffixes are ignored (equal cores → not newer), and an
 * unparseable version is treated conservatively as "not newer" (no prompt). */
function isNewer(latest: string, current: string): boolean {
  const a = parseCore(latest);
  const b = parseCore(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function readCache(path: string): UpdateCache {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" ? (data as UpdateCache) : {};
  } catch {
    return {};
  }
}

function writeCache(path: string, cache: UpdateCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache));
  } catch {
    // Best-effort throttle; never break the host CLI over a cache write.
  }
}

/**
 * Best-effort "a newer version is available — update?" check for a host CLI to
 * call early in its dispatch. Designed to never throw into or block the host:
 * it self-skips in CI, when opted out (`NO_UPDATE_NOTIFIER`), when
 * non-interactive, or within the throttle window, and swallows any
 * registry/cache failure. When a newer version exists and we're interactive, it
 * prompts `[Y/n]` (Enter = yes) and, on accept, delegates to
 * {@link runSelfUpdate}.
 */
export async function maybeOfferUpdate(
  opts: UpdateNotifierOptions,
): Promise<UpdateNotifierResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? DAY_MS;
  const interactive =
    opts.interactive ??
    (Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY));

  if (env.CI) return { checked: false, reason: "ci" };
  if (env.NO_UPDATE_NOTIFIER) return { checked: false, reason: "opted-out" };
  if (!interactive) return { checked: false, reason: "non-interactive" };

  try {
    const cachePath = opts.cachePath ?? join(cacheRoot(), "update-check.json");
    const cache = readCache(cachePath);
    const prev = cache[opts.packageName];
    if (prev && now() - prev.lastCheck < ttlMs) {
      return { checked: false, reason: "throttled" };
    }

    let latest: string;
    try {
      latest = await spawnCapture("npm", [
        "view",
        opts.packageName,
        "version",
        ...registryArgs(opts.packageName, opts.registry),
      ]);
    } catch {
      // Throttle even on failure so a flaky/unreachable registry isn't queried
      // on every invocation; keep any previously-known latest.
      writeCache(cachePath, {
        ...cache,
        [opts.packageName]: { lastCheck: now(), latest: prev?.latest ?? "" },
      });
      return { checked: false, reason: "error" };
    }

    writeCache(cachePath, {
      ...cache,
      [opts.packageName]: { lastCheck: now(), latest },
    });

    if (!isNewer(latest, opts.currentVersion)) {
      return { checked: true, latest, updateAvailable: false };
    }

    const confirm = opts.confirm ?? defaultConfirm;
    const accepted = confirm(
      `Update available: ${opts.packageName} ${opts.currentVersion} → ${latest}. Update now?`,
    );
    if (!accepted) {
      return { checked: true, latest, updateAvailable: true, updated: false };
    }

    const result = await runSelfUpdate({
      packageName: opts.packageName,
      currentVersion: opts.currentVersion,
      registry: opts.registry,
    });
    return {
      checked: true,
      latest,
      updateAvailable: true,
      updated: result.updated,
    };
  } catch {
    // Any unexpected failure (cache root resolution, install render, etc.) must
    // never break the host CLI.
    return { checked: false, reason: "error" };
  }
}
