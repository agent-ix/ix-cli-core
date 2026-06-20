import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────
// runSelfUpdate dynamically imports the renderer; stub it so the tests assert
// behavior (spawn calls + return value) rather than terminal output.
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

// spawn is mocked per-test via this queue: each entry decides how the next
// spawned process resolves.
interface SpawnPlan {
  /** stdout payload emitted before close (for the capturing `npm view`). */
  stdout?: string;
  /** exit code; non-zero rejects the spawn helper. */
  code?: number;
  /** emit an 'error' event instead of closing. */
  error?: Error;
}
let spawnQueue: SpawnPlan[];
const spawnCalls: { cmd: string; args: string[] }[] = [];

vi.mock("node:child_process", () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args });
    const plan = spawnQueue.shift() ?? { code: 0 };
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
    };
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

// Import AFTER mocks are registered.
const { runSelfUpdate } = await import("../src/commands/self-update.js");

const PKG = "@agent-ix/quoin";

beforeEach(() => {
  spawnQueue = [];
  spawnCalls.length = 0;
  renderStatic.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runSelfUpdate", () => {
  it("reports up-to-date and never installs (no registry override → ambient config)", async () => {
    spawnQueue = [{ stdout: "1.2.3\n" }];
    const result = await runSelfUpdate({
      packageName: PKG,
      currentVersion: "1.2.3",
    });
    expect(result).toEqual({ updated: false, latest: "1.2.3" });
    // Only `npm view`, no install. With no override, NO registry flag is
    // passed — npm resolves the package via the ambient config.
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toEqual(["view", PKG, "version"]);
  });

  it("with check, reports an available update without installing", async () => {
    spawnQueue = [{ stdout: "2.0.0" }];
    const result = await runSelfUpdate({
      packageName: PKG,
      currentVersion: "1.2.3",
      check: true,
    });
    expect(result).toEqual({ updated: false, latest: "2.0.0" });
    expect(spawnCalls).toHaveLength(1); // view only
  });

  it("installs the latest version when out of date", async () => {
    spawnQueue = [{ stdout: "2.0.0" }, { code: 0 }];
    const result = await runSelfUpdate({
      packageName: PKG,
      currentVersion: "1.2.3",
    });
    expect(result).toEqual({ updated: true, latest: "2.0.0" });
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1].args).toEqual(["install", "-g", `${PKG}@2.0.0`]);
  });

  it("forces a custom registry via the SCOPE override (not plain --registry)", async () => {
    spawnQueue = [{ stdout: "2.0.0" }, { code: 0 }];
    await runSelfUpdate({
      packageName: PKG,
      currentVersion: "1.2.3",
      registry: "http://npm.ix/",
    });
    // A plain --registry is ignored for scoped packages when an npmrc pins a
    // scope registry, so we must use the @scope:registry form for it to win.
    const scopeFlag = "--@agent-ix:registry=http://npm.ix/";
    expect(spawnCalls[0].args).toEqual(["view", PKG, "version", scopeFlag]);
    expect(spawnCalls[1].args).toEqual([
      "install",
      "-g",
      `${PKG}@2.0.0`,
      scopeFlag,
    ]);
  });

  it("uses plain --registry for an unscoped package", async () => {
    spawnQueue = [{ stdout: "1.0.0" }];
    await runSelfUpdate({
      packageName: "some-cli",
      currentVersion: "0.9.0",
      registry: "https://registry.npmjs.org/",
    });
    expect(spawnCalls[0].args).toEqual([
      "view",
      "some-cli",
      "version",
      "--registry",
      "https://registry.npmjs.org/",
    ]);
  });

  it("throws when the registry is unreachable", async () => {
    spawnQueue = [{ error: new Error("ENOTFOUND") }];
    await expect(
      runSelfUpdate({ packageName: PKG, currentVersion: "1.2.3" }),
    ).rejects.toThrow("ENOTFOUND");
    expect(spawnCalls).toHaveLength(1); // never reached install
  });
});
