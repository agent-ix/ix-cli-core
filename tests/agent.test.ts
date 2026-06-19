import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  agentConfig,
  bootstrapIntoAgent,
  BOOTSTRAP_GUARD_ENV,
  isInteractiveHuman,
  listIncidents,
  maybeBootstrapAgent,
  parseChoice,
  parseConfirmAnswer,
  runningUnderAgent,
  splitAgentCommand,
  COMMON_AGENTS,
  _resetRegistryForTests,
  type BootstrapDeps,
} from "../src/index.js";

// ── Detection ────────────────────────────────────────────────────────────

describe("runningUnderAgent — FR-020 env-marker detection", () => {
  for (const marker of [
    "CLAUDECODE",
    "AI_AGENT",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    BOOTSTRAP_GUARD_ENV,
  ]) {
    it(`is true when ${marker} is present`, () => {
      expect(runningUnderAgent({ [marker]: "anything-nonempty" })).toBe(true);
    });
  }

  it("is true for a non-1 marker value (e.g. AI_AGENT=claude-code_x_agent)", () => {
    expect(runningUnderAgent({ AI_AGENT: "claude-code_2-1-177_agent" })).toBe(
      true,
    );
  });

  it("is false when no marker is set", () => {
    expect(runningUnderAgent({})).toBe(false);
  });

  it("treats an empty-string marker as absent", () => {
    expect(runningUnderAgent({ CLAUDECODE: "" })).toBe(false);
  });
});

describe("isInteractiveHuman — FR-020 / NFR-007 gating", () => {
  const base: BootstrapDeps = { env: {}, stdinIsTTY: true, stdoutIsTTY: true };

  it("is true for both-TTY, no markers, no opt-out", () => {
    expect(isInteractiveHuman(base)).toBe(true);
  });

  it("is false when stdin is not a TTY", () => {
    expect(isInteractiveHuman({ ...base, stdinIsTTY: false })).toBe(false);
  });

  it("is false when stdout is not a TTY", () => {
    expect(isInteractiveHuman({ ...base, stdoutIsTTY: false })).toBe(false);
  });

  it("is false under an agent marker", () => {
    expect(isInteractiveHuman({ ...base, env: { CLAUDECODE: "1" } })).toBe(
      false,
    );
  });

  it("is false when IX_NO_AUTO_AGENT is truthy", () => {
    expect(
      isInteractiveHuman({ ...base, env: { IX_NO_AUTO_AGENT: "1" } }),
    ).toBe(false);
  });

  it("is NOT opted out by IX_NO_AUTO_AGENT=0", () => {
    expect(
      isInteractiveHuman({ ...base, env: { IX_NO_AUTO_AGENT: "0" } }),
    ).toBe(true);
  });
});

// ── Pure helpers ───────────────────────────────────────────────────────────

describe("splitAgentCommand", () => {
  it("splits a bare binary", () => {
    expect(splitAgentCommand("claude")).toEqual(["claude"]);
  });
  it("splits a command with args and collapses whitespace", () => {
    expect(splitAgentCommand("  claude   --model  opus ")).toEqual([
      "claude",
      "--model",
      "opus",
    ]);
  });
});

describe("parseConfirmAnswer", () => {
  it.each([
    ["", true],
    ["y", true],
    ["Y", true],
    ["yes", true],
    ["  yes ", true],
    ["n", false],
    ["no", false],
    ["nope", false],
  ])("%j → %s", (input, expected) => {
    expect(parseConfirmAnswer(input)).toBe(expected);
  });
});

describe("parseChoice", () => {
  it("maps a numeric pick to its agent", () => {
    expect(parseChoice("2", COMMON_AGENTS)).toEqual({
      kind: "agent",
      command: "codex",
    });
  });
  it("bare Enter selects the first option", () => {
    expect(parseChoice("", COMMON_AGENTS)).toEqual({
      kind: "agent",
      command: "claude",
    });
  });
  it("maps the literal agent name", () => {
    expect(parseChoice("claude", COMMON_AGENTS)).toEqual({
      kind: "agent",
      command: "claude",
    });
  });
  it("maps the next index and the word 'other' to other", () => {
    expect(
      parseChoice(String(COMMON_AGENTS.length + 1), COMMON_AGENTS),
    ).toEqual({ kind: "other" });
    expect(parseChoice("other", COMMON_AGENTS)).toEqual({ kind: "other" });
  });
  it("maps q / unknown to cancel", () => {
    expect(parseChoice("q", COMMON_AGENTS)).toEqual({ kind: "cancel" });
    expect(parseChoice("99", COMMON_AGENTS)).toEqual({ kind: "cancel" });
  });
});

// ── bootstrapIntoAgent (dependency-injected; never spawns a real process) ───

interface Spy {
  spawn: {
    cmd: string;
    args: string[];
    opts: { stdio?: unknown; env?: NodeJS.ProcessEnv };
  }[];
  exit: number[];
  log: string[];
}

function makeDeps(over: Partial<BootstrapDeps> = {}): {
  deps: BootstrapDeps;
  spy: Spy;
} {
  const spy: Spy = { spawn: [], exit: [], log: [] };
  const deps: BootstrapDeps = {
    env: {},
    stdinIsTTY: true,
    stdoutIsTTY: true,
    spawn: (cmd, args, opts) => {
      spy.spawn.push({ cmd, args, opts });
      return { status: 0 };
    },
    exit: (code) => {
      spy.exit.push(code);
    },
    log: (m) => spy.log.push(m),
    ...over,
  };
  return { deps, spy };
}

describe("bootstrapIntoAgent — FR-021 launcher", () => {
  it("mode 'off' is a no-op", () => {
    const { deps, spy } = makeDeps();
    expect(
      bootstrapIntoAgent({ seed: "x", mode: "off", agent: "claude", deps }),
    ).toBe(false);
    expect(spy.spawn).toHaveLength(0);
  });

  it("does nothing when not an interactive human", () => {
    const { deps, spy } = makeDeps({ stdinIsTTY: false });
    expect(
      bootstrapIntoAgent({ seed: "x", mode: "auto", agent: "claude", deps }),
    ).toBe(false);
    expect(spy.spawn).toHaveLength(0);
  });

  it("does nothing under an agent marker (fork-bomb guard)", () => {
    const { deps, spy } = makeDeps({ env: { CLAUDECODE: "1" } });
    expect(
      bootstrapIntoAgent({ seed: "x", mode: "auto", agent: "claude", deps }),
    ).toBe(false);
    expect(spy.spawn).toHaveLength(0);
  });

  it("auto mode launches interactively with the guard + seed", () => {
    const { deps, spy } = makeDeps();
    const r = bootstrapIntoAgent({
      seed: "do the thing",
      mode: "auto",
      agent: "claude",
      deps,
    });
    expect(r).toBe(true);
    expect(spy.spawn).toHaveLength(1);
    expect(spy.spawn[0]!.cmd).toBe("claude");
    expect(spy.spawn[0]!.args).toEqual(["do the thing"]);
    expect(spy.spawn[0]!.opts.stdio).toBe("inherit");
    expect(spy.spawn[0]!.opts.env?.[BOOTSTRAP_GUARD_ENV]).toBe("1");
    expect(spy.exit).toEqual([0]);
  });

  it("splits a multi-word command and appends the seed last", () => {
    const { deps, spy } = makeDeps();
    bootstrapIntoAgent({
      seed: "S",
      mode: "auto",
      agent: "claude --model opus",
      deps,
    });
    expect(spy.spawn[0]!.cmd).toBe("claude");
    expect(spy.spawn[0]!.args).toEqual(["--model", "opus", "S"]);
  });

  it("prompt mode: declined confirm does not launch", () => {
    const { deps, spy } = makeDeps({ confirm: () => false });
    expect(
      bootstrapIntoAgent({ seed: "x", mode: "prompt", agent: "claude", deps }),
    ).toBe(false);
    expect(spy.spawn).toHaveLength(0);
  });

  it("prompt mode: accepted confirm launches", () => {
    const { deps, spy } = makeDeps({ confirm: () => true });
    bootstrapIntoAgent({ seed: "x", mode: "prompt", agent: "claude", deps });
    expect(spy.spawn).toHaveLength(1);
  });

  it("forwards the child's exit status", () => {
    const { deps, spy } = makeDeps({ spawn: () => ({ status: 3 }) });
    bootstrapIntoAgent({ seed: "x", mode: "auto", agent: "claude", deps });
    expect(spy.exit).toEqual([3]);
  });

  it("maps a signal death (null status) to exit 0", () => {
    const { deps, spy } = makeDeps({
      spawn: () => ({ status: null, signal: "SIGINT" }),
    });
    bootstrapIntoAgent({ seed: "x", mode: "auto", agent: "claude", deps });
    expect(spy.exit).toEqual([0]);
  });

  it("ENOENT is non-fatal: returns false, no exit, logs a hint", () => {
    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    const { deps, spy } = makeDeps({
      spawn: () => ({ status: null, error: err }),
    });
    expect(
      bootstrapIntoAgent({ seed: "x", mode: "auto", agent: "nope", deps }),
    ).toBe(false);
    expect(spy.exit).toHaveLength(0);
    expect(spy.log.join("\n")).toContain("Continuing without it");
  });
});

describe("bootstrapIntoAgent — FR-022 chooser (unset agent)", () => {
  it("launches the chosen agent and offers to persist it", () => {
    const persisted: string[] = [];
    const { deps, spy } = makeDeps({
      choose: () => "codex",
      confirm: () => true,
    });
    bootstrapIntoAgent({
      seed: "x",
      mode: "prompt",
      agent: undefined,
      persist: (c) => persisted.push(c),
      deps,
    });
    expect(spy.spawn[0]!.cmd).toBe("codex");
    expect(persisted).toEqual(["codex"]);
  });

  it("launches but does not persist when the save prompt is declined", () => {
    const persisted: string[] = [];
    const { deps, spy } = makeDeps({
      choose: () => "codex",
      confirm: () => false,
    });
    bootstrapIntoAgent({
      seed: "x",
      mode: "prompt",
      persist: (c) => persisted.push(c),
      deps,
    });
    expect(spy.spawn).toHaveLength(1);
    expect(persisted).toEqual([]);
  });

  it("does not persist a chooser pick that fails to launch (ENOENT)", () => {
    const persisted: string[] = [];
    const err = Object.assign(new Error("nf"), { code: "ENOENT" });
    let spawnCalls = 0;
    const { deps } = makeDeps({
      choose: () => "badcmd",
      confirm: () => true,
      spawn: () => {
        spawnCalls++;
        return { status: null, error: err };
      },
    });
    const r = bootstrapIntoAgent({
      seed: "x",
      mode: "prompt",
      persist: (c) => persisted.push(c),
      deps,
    });
    expect(r).toBe(false);
    expect(spawnCalls).toBe(1); // launch was attempted…
    expect(persisted).toEqual([]); // …but the failed command was not saved
  });

  it("cancelled chooser is a no-op", () => {
    const { deps, spy } = makeDeps({ choose: () => undefined });
    expect(bootstrapIntoAgent({ seed: "x", mode: "prompt", deps })).toBe(false);
    expect(spy.spawn).toHaveLength(0);
  });
});

// ── Config namespace (agent.*) ──────────────────────────────────────────────

describe("agentConfig — FR-022 config + env override", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ix-agent-"));
    process.env.XDG_CONFIG_HOME = dir;
    delete process.env.IX_PREFERRED_AGENT;
    delete process.env.IX_AUTO_LAUNCH_AGENT;
    _resetRegistryForTests();
  });

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.IX_PREFERRED_AGENT;
    delete process.env.IX_AUTO_LAUNCH_AGENT;
    rmSync(dir, { recursive: true, force: true });
    _resetRegistryForTests();
  });

  it("defaults: autoLaunch=prompt, preferredAgent unset", () => {
    const v = agentConfig().get();
    expect(v.autoLaunch).toBe("prompt");
    expect(v.preferredAgent).toBeUndefined();
  });

  it("file value wins over default", () => {
    const cfg = agentConfig();
    cfg.set({ preferredAgent: "claude", autoLaunch: "auto" });
    const v = cfg.get();
    expect(v.preferredAgent).toBe("claude");
    expect(v.autoLaunch).toBe("auto");
  });

  it("env beats file for preferredAgent", () => {
    const cfg = agentConfig();
    cfg.set({ preferredAgent: "claude" });
    process.env.IX_PREFERRED_AGENT = "codex";
    expect(cfg.get().preferredAgent).toBe("codex");
  });

  it("invalid autoLaunch via env → falls back to default + records incident", () => {
    const cfg = agentConfig();
    process.env.IX_AUTO_LAUNCH_AGENT = "loud";
    expect(cfg.get().autoLaunch).toBe("prompt");
    const incs = listIncidents().filter((i) => i.pluginId === "agent");
    expect(incs[incs.length - 1]?.kind).toBe("schema");
    expect(
      incs[incs.length - 1]?.issues?.some((it) => it.keyPath === "autoLaunch"),
    ).toBe(true);
  });

  it("rejects unknown keys (strict schema)", () => {
    const cfg = agentConfig();
    expect(() => cfg.set({ bogus: 1 } as never)).toThrow();
  });
});

describe("maybeBootstrapAgent — FR-021/FR-022 wiring", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ix-agent-"));
    process.env.XDG_CONFIG_HOME = dir;
    delete process.env.IX_PREFERRED_AGENT;
    delete process.env.IX_AUTO_LAUNCH_AGENT;
    _resetRegistryForTests();
  });

  afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.IX_PREFERRED_AGENT;
    delete process.env.IX_AUTO_LAUNCH_AGENT;
    rmSync(dir, { recursive: true, force: true });
    _resetRegistryForTests();
  });

  it("reads config and launches the configured agent", () => {
    agentConfig().set({ preferredAgent: "claude", autoLaunch: "auto" });
    const { deps, spy } = makeDeps();
    expect(maybeBootstrapAgent("seed text", deps)).toBe(true);
    expect(spy.spawn[0]!.cmd).toBe("claude");
    expect(spy.spawn[0]!.args).toEqual(["seed text"]);
    expect(spy.exit).toEqual([0]);
  });

  it("is a no-op when not an interactive human", () => {
    agentConfig().set({ preferredAgent: "claude", autoLaunch: "auto" });
    const { deps, spy } = makeDeps({ stdinIsTTY: false });
    expect(maybeBootstrapAgent("x", deps)).toBe(false);
    expect(spy.spawn).toHaveLength(0);
  });

  it("respects autoLaunch=off from config", () => {
    agentConfig().set({ preferredAgent: "claude", autoLaunch: "off" });
    const { deps, spy } = makeDeps();
    expect(maybeBootstrapAgent("x", deps)).toBe(false);
    expect(spy.spawn).toHaveLength(0);
  });
});
