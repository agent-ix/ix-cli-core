import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readSync } from "node:fs";

/**
 * Agent-context detection and bootstrap-into-preferred-agent.
 *
 * Agent-facing CLIs built on this framework (e.g. ix-spec, ix-flow) are meant
 * to be driven by an agent harness (Claude Code / Codex) that shells out and
 * reads stdout — not typed by a human. When a human runs one directly from an
 * interactive shell, the CLI can optionally hand off into the human's preferred
 * agent CLI, seeded with their request, so they land in a live interactive
 * session already working on it.
 *
 * This module is the generic MECHANISM. Consumers decide whether/when to call
 * it (policy stays in the leaf). The companion `agent-config.ts` wires the
 * mechanism to a framework-owned config namespace.
 */

/** Env vars whose presence means we are already inside an agent harness. */
export const AGENT_ENV_MARKERS = [
  "CLAUDECODE",
  "AI_AGENT",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
] as const;

/** Set on the child env when we bootstrap; the re-entry guard that prevents a
 * fork-bomb when the launched agent shells back into the same CLI. */
export const BOOTSTRAP_GUARD_ENV = "IX_AGENT_BOOTSTRAPPED";

/** Global opt-out for the auto-agent mechanism (CI / scripted / power users). */
export const NO_AUTO_AGENT_ENV = "IX_NO_AUTO_AGENT";

/** Common agent CLIs offered by the interactive chooser when none is set. */
export const COMMON_AGENTS = ["claude", "codex"] as const;

export type AutoLaunchMode = "off" | "prompt" | "auto";

type SpawnResult = {
  status: number | null;
  error?: Error;
  signal?: NodeJS.Signals | null;
};

type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnSyncOptions,
) => SpawnResult;

/**
 * Injectable seams. All default to `process.*`; production callers leave these
 * unset. Tests inject doubles so no real process is ever spawned.
 */
export interface BootstrapDeps {
  env?: NodeJS.ProcessEnv;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  /** Defaults to `spawnSync`. */
  spawn?: SpawnFn;
  /** Defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** `[Y/n]` confirm for prompt mode + the chooser's save step. */
  confirm?: (question: string) => boolean;
  /** Interactive agent chooser when no agent is configured. */
  choose?: () => string | undefined;
  /** Free-text command entry for the chooser's "other" option. */
  prompt?: (label: string) => string | undefined;
  /** Sink for one-line notices. Defaults to stdout. */
  log?: (message: string) => void;
}

export interface BootstrapOptions {
  /** Consumer-built prompt to seed the agent session. */
  seed: string;
  /** Resolved policy. */
  mode: AutoLaunchMode;
  /** Resolved agent command; when empty/unset, the chooser runs. */
  agent?: string;
  /** Optional sink to persist a chooser pick (e.g. to config). */
  persist?: (command: string) => void;
  deps?: BootstrapDeps;
}

/** Any non-empty string counts as "present" — agent markers carry arbitrary
 * values (e.g. `AI_AGENT=claude-code_2-1-177_agent`), not just `1`/`true`. */
function isPresent(v: string | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** Strict truthiness for explicit boolean-ish flags (so `=0` does not opt in). */
function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** True if any agent marker OR our re-entry guard is set in `env`. */
export function runningUnderAgent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isPresent(env[BOOTSTRAP_GUARD_ENV])) return true;
  return AGENT_ENV_MARKERS.some((k) => isPresent(env[k]));
}

/** True only for a real human at an interactive terminal with opt-out unset. */
export function isInteractiveHuman(deps: BootstrapDeps = {}): boolean {
  const env = deps.env ?? process.env;
  if (runningUnderAgent(env)) return false;
  if (isTruthy(env[NO_AUTO_AGENT_ENV])) return false;
  const stdinTTY = deps.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const stdoutTTY = deps.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  return stdinTTY && stdoutTTY;
}

/** Split a configured agent command into argv. No shell; whitespace split. */
export function splitAgentCommand(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

/** Parse a `[Y/n]` answer; bare Enter (empty) defaults to yes. */
export function parseConfirmAnswer(raw: string): boolean {
  const a = raw.trim().toLowerCase();
  return a === "" || a === "y" || a === "yes";
}

export type ChoiceResult =
  | { kind: "agent"; command: string }
  | { kind: "other" }
  | { kind: "cancel" };

/** Map a chooser answer (number, agent name, "other", or "q") to a result.
 * Bare Enter selects the first option. Unrecognized input cancels. */
export function parseChoice(
  raw: string,
  options: readonly string[],
): ChoiceResult {
  const a = raw.trim().toLowerCase();
  const first = options[0];
  if (a === "")
    return first ? { kind: "agent", command: first } : { kind: "cancel" };
  if (a === "q" || a === "cancel") return { kind: "cancel" };
  if (a === "other" || a === String(options.length + 1))
    return { kind: "other" };
  const n = Number.parseInt(a, 10);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) {
    const pick = options[n - 1];
    if (pick) return { kind: "agent", command: pick };
  }
  const match = options.find((o) => o.toLowerCase() === a);
  if (match) return { kind: "agent", command: match };
  return { kind: "cancel" };
}

/**
 * Bootstrap into the preferred agent CLI when appropriate.
 *
 * Returns `false` (caller proceeds with its own command) when: mode is "off",
 * the caller is not an interactive human, the chooser is cancelled, or the
 * spawn fails to start (e.g. ENOENT — non-fatal). Otherwise spawns the agent
 * interactively (stdio inherited), waits, and exits with the child's status —
 * this does not return on the launch path in production.
 */
export function bootstrapIntoAgent(opts: BootstrapOptions): boolean {
  const deps = opts.deps ?? {};
  if (opts.mode === "off") return false;
  if (!isInteractiveHuman(deps)) return false;

  const log = deps.log ?? stdoutLine;
  const confirm = deps.confirm ?? defaultConfirm;

  let command = (opts.agent ?? "").trim();
  let fromChooser = false;

  if (!command) {
    const choose = deps.choose ?? (() => defaultChoose(deps));
    const chosen = choose();
    if (!chosen || !chosen.trim()) return false; // cancelled
    command = chosen.trim();
    fromChooser = true;
  } else if (opts.mode === "prompt") {
    if (!confirm(`Launch ${command} to work on this request?`)) return false;
  }

  // Decide whether to remember a chooser pick now (good UX — it belongs to the
  // chooser flow), but only WRITE it after a clean launch (below) so a command
  // that fails to start is never persisted.
  const savePick =
    fromChooser && opts.persist
      ? confirm(`Save "${command}" as your preferred agent?`)
      : false;

  const argv = splitAgentCommand(command);
  const bin = argv[0];
  if (!bin) return false;
  const rest = argv.slice(1);

  const baseEnv = deps.env ?? process.env;
  const childEnv = { ...baseEnv, [BOOTSTRAP_GUARD_ENV]: "1" };
  const spawn = deps.spawn ?? (spawnSync as unknown as SpawnFn);
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const result = spawn(bin, [...rest, opts.seed], {
    stdio: "inherit",
    env: childEnv,
  });

  if (result.error) {
    const code =
      (result.error as NodeJS.ErrnoException).code ?? result.error.message;
    log(`Could not launch "${bin}" (${code}). Continuing without it.`);
    return false; // never persist a command that failed to launch
  }

  // Launch succeeded — now it is safe to remember the pick.
  if (savePick && opts.persist) {
    try {
      opts.persist(command);
    } catch {
      /* persistence is best-effort; never block on it */
    }
  }

  // `spawnSync` blocks until the child exits and routes SIGINT to the
  // foreground child; forward its status. In production this terminates the
  // process; the `return true` is only reached when `exit` is a test double.
  exit(result.status ?? 0);
  return true;
}

// ── Default interactive readers (TTY). Injectable via `deps` for tests. ──────

/** Write a single line to stdout. */
function stdoutLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Block briefly without a busy-loop (used to wait on a non-blocking TTY). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Read a single line synchronously from fd 0 (stdin is a cooked TTY here).
 * Bytes are accumulated and decoded once at the end so multi-byte UTF-8 input
 * (e.g. a non-ASCII custom command) survives intact. */
function readLineSync(): string {
  const buf = Buffer.alloc(1);
  const bytes: number[] = [];
  for (;;) {
    let n = 0;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "EAGAIN") {
        sleepSync(10); // input not ready yet; wait for the human to type
        continue;
      }
      break; // EOF / unreadable — treat as end of input
    }
    if (n === 0) break;
    const b = buf[0]!;
    if (b === 0x0a) break; // \n
    if (b === 0x0d) continue; // \r
    bytes.push(b);
  }
  return Buffer.from(bytes).toString("utf8");
}

function defaultConfirm(question: string): boolean {
  process.stdout.write(`${question} [Y/n] `);
  return parseConfirmAnswer(readLineSync());
}

function defaultPrompt(label: string): string | undefined {
  process.stdout.write(`${label} `);
  const line = readLineSync().trim();
  return line.length > 0 ? line : undefined;
}

function defaultChoose(deps: BootstrapDeps): string | undefined {
  const out = deps.log ?? stdoutLine;
  out("No preferred agent configured. How would you like to launch?");
  COMMON_AGENTS.forEach((a, i) => out(`  ${i + 1}) ${a}`));
  out(`  ${COMMON_AGENTS.length + 1}) other (enter a command)`);
  out("  q) cancel");
  process.stdout.write("Choose [1]: ");
  const choice = parseChoice(readLineSync(), COMMON_AGENTS);
  if (choice.kind === "cancel") return undefined;
  if (choice.kind === "agent") return choice.command;
  const enter = deps.prompt ?? defaultPrompt;
  return enter("Enter launch command:");
}
