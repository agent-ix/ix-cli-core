import { spawn } from "node:child_process";

import type * as IxUiCli from "@agent-ix/ix-ui-cli";

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
