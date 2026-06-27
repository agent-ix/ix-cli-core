import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// runSelfUpdate (invoked on accept) dynamically imports the renderer; stub it so
// the tests assert behavior (spawn calls + return value) rather than output.
const renderStatic = vi.fn(async () => {});
vi.mock("@agent-ix/ix-ui-cli", () => {
  const passthrough = (s: unknown) => s;
  const Noop = () => null;
  return {
    FlowLine: Noop,
    Listing: Noop,
    Note: Noop,
    blue: passthrough,
    colors: { dim: passthrough },
    renderStatic,
  };
});

interface SpawnPlan {
  stdout?: string;
  code?: number;
  error?: Error;
}
let spawnQueue: SpawnPlan[];
const spawnCalls: { cmd: string; args: string[] }[] = [];

vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    const plan = spawnQueue.shift() ?? { code: 0 };
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
    proc.stdout = new EventEmitter();
    queueMicrotask(() => {
      if (plan.error) {
        proc.emit("error", plan.error);
        return;
      }
      if (plan.stdout) proc.stdout.emit("data", Buffer.from(plan.stdout));
      proc.emit("close", plan.code ?? 0);
    });
    return proc;
  },
}));

const { maybeOfferUpdate } = await import("../src/commands/self-update.js");

const PKG = "@agent-ix/quoin";
const NOW = 1_700_000_000_000;

function tempCache(): string {
  return join(mkdtempSync(join(tmpdir(), "ixupd-")), "update-check.json");
}

/** Base options: interactive, fixed clock, temp cache, no real env/prompt. */
function opts(over: Partial<Parameters<typeof maybeOfferUpdate>[0]> = {}) {
  return {
    packageName: PKG,
    currentVersion: "0.4.0",
    interactive: true,
    now: () => NOW,
    env: {} as NodeJS.ProcessEnv,
    cachePath: tempCache(),
    confirm: () => true,
    ...over,
  };
}

beforeEach(() => {
  spawnQueue = [];
  spawnCalls.length = 0;
  renderStatic.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("maybeOfferUpdate — skips", () => {
  it("skips in CI without querying the registry", async () => {
    const r = await maybeOfferUpdate(opts({ env: { CI: "true" } }));
    expect(r).toEqual({ checked: false, reason: "ci" });
    expect(spawnCalls).toHaveLength(0);
  });

  it("skips when opted out via NO_UPDATE_NOTIFIER", async () => {
    const r = await maybeOfferUpdate(
      opts({ env: { NO_UPDATE_NOTIFIER: "1" } }),
    );
    expect(r).toEqual({ checked: false, reason: "opted-out" });
    expect(spawnCalls).toHaveLength(0);
  });

  it("skips when non-interactive", async () => {
    const r = await maybeOfferUpdate(opts({ interactive: false }));
    expect(r).toEqual({ checked: false, reason: "non-interactive" });
    expect(spawnCalls).toHaveLength(0);
  });

  it("skips within the throttle window using a seeded cache", async () => {
    const cachePath = tempCache();
    writeFileSync(
      cachePath,
      JSON.stringify({ [PKG]: { lastCheck: NOW - 1000, latest: "0.9.0" } }),
    );
    const r = await maybeOfferUpdate(opts({ cachePath, ttlMs: 10_000 }));
    expect(r).toEqual({ checked: false, reason: "throttled" });
    expect(spawnCalls).toHaveLength(0);
  });
});

describe("maybeOfferUpdate — checks", () => {
  it("offers and installs when a newer version exists and the user accepts", async () => {
    // notifier `npm view`, then runSelfUpdate's own `npm view` + install.
    spawnQueue = [{ stdout: "0.5.1\n" }, { stdout: "0.5.1" }, { code: 0 }];
    const r = await maybeOfferUpdate(opts({ confirm: () => true }));
    expect(r).toEqual({
      checked: true,
      latest: "0.5.1",
      updateAvailable: true,
      updated: true,
    });
    expect(spawnCalls[0].args).toEqual(["view", PKG, "version"]);
    expect(spawnCalls.at(-1)!.args).toEqual(["install", "-g", `${PKG}@0.5.1`]);
  });

  it("reports updated:false when the user accepts but the install fails", async () => {
    // notifier view → ok; runSelfUpdate view → ok; install → non-zero (throws).
    spawnQueue = [{ stdout: "0.5.1" }, { stdout: "0.5.1" }, { code: 1 }];
    const r = await maybeOfferUpdate(opts({ confirm: () => true }));
    expect(r).toEqual({
      checked: true,
      latest: "0.5.1",
      updateAvailable: true,
      updated: false,
    });
    expect(spawnCalls.at(-1)!.args).toEqual(["install", "-g", `${PKG}@0.5.1`]);
  });

  it("reports availability but does not install when the user declines", async () => {
    spawnQueue = [{ stdout: "0.5.1" }];
    const r = await maybeOfferUpdate(opts({ confirm: () => false }));
    expect(r).toEqual({
      checked: true,
      latest: "0.5.1",
      updateAvailable: true,
      updated: false,
    });
    expect(spawnCalls).toHaveLength(1); // view only
  });

  it("does not prompt when already on the latest", async () => {
    let prompted = false;
    spawnQueue = [{ stdout: "0.4.0" }];
    const r = await maybeOfferUpdate(
      opts({
        currentVersion: "0.4.0",
        confirm: () => {
          prompted = true;
          return true;
        },
      }),
    );
    expect(r).toEqual({
      checked: true,
      latest: "0.4.0",
      updateAvailable: false,
    });
    expect(prompted).toBe(false);
  });

  it("does not prompt a dev build that is ahead of the published version", async () => {
    spawnQueue = [{ stdout: "0.5.1" }];
    const r = await maybeOfferUpdate(
      opts({ currentVersion: "0.5.2-3-gabc123-dirty", confirm: () => true }),
    );
    expect(r).toEqual({
      checked: true,
      latest: "0.5.1",
      updateAvailable: false,
    });
  });

  it("records the check in the cache so the next call is throttled", async () => {
    const cachePath = tempCache();
    spawnQueue = [{ stdout: "0.5.1" }];
    await maybeOfferUpdate(opts({ cachePath, confirm: () => false }));
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as Record<
      string,
      { lastCheck: number; latest: string }
    >;
    expect(cache[PKG]).toEqual({ lastCheck: NOW, latest: "0.5.1" });
  });

  it("swallows a registry failure and throttles without breaking the host", async () => {
    const cachePath = tempCache();
    spawnQueue = [{ error: new Error("ENOTFOUND") }];
    const r = await maybeOfferUpdate(opts({ cachePath }));
    expect(r).toEqual({ checked: false, reason: "error" });
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as Record<
      string,
      { lastCheck: number; latest: string }
    >;
    expect(cache[PKG].lastCheck).toBe(NOW); // throttled despite the failure
  });
});
