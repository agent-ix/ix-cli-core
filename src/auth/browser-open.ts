import { spawn } from "node:child_process";
import { platform } from "node:process";

/**
 * Best-effort, non-fatal browser opener.
 *
 * Device-flow approval happens in a browser, but the CLI must never fail if a
 * browser cannot be launched (headless CI, SSH sessions, locked-down
 * environments). The verification URI is always printed by the caller; this is
 * only a convenience.
 *
 * WSL note: `xdg-open` is usually absent or broken under WSL. We try
 * `wslview` first (ships with `wslu`) and fall back through the platform
 * opener; any failure resolves to `false` and is swallowed by the caller.
 *
 * @returns `true` if an opener process was spawned without an immediate error,
 *          `false` otherwise. A `true` result does NOT guarantee a window
 *          actually appeared — only that the launch did not synchronously fail.
 */
export async function openBrowser(
  url: string,
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  const env = opts.env ?? process.env;

  // Honor an explicit opt-out used by CI and scripted runs.
  if (isTruthy(env.IX_NO_BROWSER) || isTruthy(env.NO_BROWSER)) {
    return false;
  }

  for (const candidate of openerCandidates(env)) {
    const ok = await trySpawn(candidate.command, [...candidate.args, url]);
    if (ok) return true;
  }
  return false;
}

interface Opener {
  command: string;
  args: string[];
}

function openerCandidates(env: NodeJS.ProcessEnv): Opener[] {
  const isWsl =
    Boolean(env.WSL_DISTRO_NAME) ||
    Boolean(env.WSL_INTEROP) ||
    /microsoft/i.test(env.WSL_DISTRO_NAME ?? "");

  if (platform === "darwin") {
    return [{ command: "open", args: [] }];
  }
  if (platform === "win32") {
    // `cmd /c start "" <url>` — the empty title arg avoids treating the URL
    // as a window title.
    return [{ command: "cmd", args: ["/c", "start", ""] }];
  }
  // Linux (incl. WSL): prefer wslview under WSL, then the standard openers.
  const linux: Opener[] = [
    { command: "xdg-open", args: [] },
    { command: "gio", args: ["open"] },
  ];
  if (isWsl) {
    return [
      { command: "wslview", args: [] },
      { command: "cmd.exe", args: ["/c", "start", ""] },
      ...linux,
    ];
  }
  return linux;
}

/**
 * Spawn a detached opener. Resolves `true` if the process started without an
 * immediate `error` event, `false` otherwise. Never rejects.
 */
function trySpawn(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(command, args, {
        stdio: "ignore",
        detached: true,
      });
      child.on("error", () => done(false));
      // Give the spawn a brief moment to surface a synchronous ENOENT.
      const t = setTimeout(() => {
        child.unref();
        done(true);
      }, 120);
      // Don't let the timer keep the event loop alive.
      if (typeof t.unref === "function") t.unref();
    } catch {
      done(false);
    }
  });
}

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}
