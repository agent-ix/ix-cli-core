import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listCorePlugins, loadConfig, run } from "../src/index.js";

/**
 * FR-015 / TC-015 — oclif runner + core-plugin host.
 *
 * Builds a throwaway "consumer CLI" on disk (a host package with its own
 * `oclif.commands` dir plus a bundled core plugin declared in `oclif.plugins`)
 * and drives it through the exported {@link run} runner. The fixture command
 * modules are loaded natively by `@oclif/core`, so they import `BaseCommand`
 * from the built package via a symlink into the fixture's `node_modules` —
 * exactly how a real consumer (quoin) imports it.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(repoRoot, "dist", "index.js");

let tmp: string;

const consumerPkg = {
  name: "@ixcc-fixture/consumer",
  version: "0.0.0",
  type: "module",
  bin: { ixfix: "./bin/run.js" },
  oclif: {
    bin: "ixfix",
    commands: "./commands",
    // Declare the bundled package as an oclif *core plugin*. oclif matches
    // this against `dependencies` and loads it from node_modules.
    plugins: ["@ixcc-fixture/hello-plugin"],
  },
  dependencies: { "@ixcc-fixture/hello-plugin": "*" },
};

const pluginPkg = {
  name: "@ixcc-fixture/hello-plugin",
  version: "0.0.0",
  type: "module",
  oclif: { commands: "./commands" },
};

// Host command: a BaseCommand subclass. Writes its parsed base flags to a file
// so the test can assert end-to-end dispatch AND base-flag plumbing.
const greetCmd = `
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { Flags } from "@oclif/core";
import { writeFileSync } from "node:fs";

export default class Greet extends BaseCommand {
  static description = "greet (host BaseCommand subclass)";
  static flags = { out: Flags.string({ required: true }) };
  async run() {
    const { flags } = await this.parse(Greet);
    writeFileSync(
      flags.out,
      "greet|config-root=" +
        (flags["config-root"] ?? "") +
        "|no-project=" +
        flags["no-project-config"],
    );
    this.log("greet ran");
  }
}
`;

// Core-plugin command: also a BaseCommand subclass, contributed by the plugin.
const helloCmd = `
import { BaseCommand } from "@agent-ix/ix-cli-core";
import { Flags } from "@oclif/core";
import { writeFileSync } from "node:fs";

export default class Hello extends BaseCommand {
  static description = "hello (contributed by a core plugin)";
  static flags = { out: Flags.string({ required: true }) };
  async run() {
    const { flags } = await this.parse(Hello);
    writeFileSync(flags.out, "hello-plugin ran");
  }
}
`;

// Host command declaring an unsatisfiable required capability. Used to prove
// the capability hook (prerun) fires through the runner's lifecycle.
const guardedCmd = `
import { BaseCommand } from "@agent-ix/ix-cli-core";

export default class Guarded extends BaseCommand {
  static description = "requires the github capability";
  static capabilities = { required: ["github"] };
  async run() {
    this.log("should never run");
  }
}
`;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

beforeAll(() => {
  // The fixture command modules import the *built* package, mirroring a real
  // consumer. Ensure dist exists (CI builds before test; build on demand for a
  // clean local checkout).
  if (!existsSync(distEntry)) {
    execSync("pnpm run build", { cwd: repoRoot, stdio: "inherit" });
  }

  tmp = mkdtempSync(join(tmpdir(), "ixcc-runner-"));

  // ── host package ──────────────────────────────────────────────────────
  writeJson(join(tmp, "package.json"), consumerPkg);
  mkdirSync(join(tmp, "commands"), { recursive: true });
  writeFileSync(join(tmp, "commands", "greet.js"), greetCmd);
  writeFileSync(join(tmp, "commands", "guarded.js"), guardedCmd);

  // ── node_modules: symlink the package under test + @oclif/core ─────────
  mkdirSync(join(tmp, "node_modules", "@agent-ix"), { recursive: true });
  mkdirSync(join(tmp, "node_modules", "@oclif"), { recursive: true });
  mkdirSync(join(tmp, "node_modules", "@ixcc-fixture"), { recursive: true });
  symlinkSync(
    repoRoot,
    join(tmp, "node_modules", "@agent-ix", "ix-cli-core"),
    "dir",
  );
  symlinkSync(
    join(repoRoot, "node_modules", "@oclif", "core"),
    join(tmp, "node_modules", "@oclif", "core"),
    "dir",
  );

  // ── core plugin (bundled dependency) ───────────────────────────────────
  const pluginRoot = join(tmp, "node_modules", "@ixcc-fixture", "hello-plugin");
  mkdirSync(join(pluginRoot, "commands"), { recursive: true });
  writeJson(join(pluginRoot, "package.json"), pluginPkg);
  writeFileSync(join(pluginRoot, "commands", "hello.js"), helloCmd);
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("oclif runner + core-plugin host (FR-015 / TC-015)", () => {
  it("discovers the host commands AND the core-plugin's commands", async () => {
    const config = await loadConfig({ root: tmp });

    const ids = config.commandIDs;
    expect(ids).toContain("greet"); // host command
    expect(ids).toContain("hello"); // contributed by the core plugin

    const core = listCorePlugins(config);
    const plugin = core.find((p) => p.name === "@ixcc-fixture/hello-plugin");
    expect(plugin).toBeDefined();
    expect(plugin?.type).toBe("core");
    expect(plugin?.commandIDs).toContain("hello");
  });

  it("runs a host BaseCommand subclass end-to-end, with base flags parsed", async () => {
    const config = await loadConfig({ root: tmp });
    const out = join(tmp, "greet.out");

    await run(["greet", "--out", out, "--config-root", "/custom/root"], config);

    expect(readFileSync(out, "utf8")).toBe(
      "greet|config-root=/custom/root|no-project=false",
    );
  });

  it("runs a command contributed by the core plugin via the runner", async () => {
    const config = await loadConfig({ root: tmp });
    const out = join(tmp, "hello.out");

    await run(["hello", "--out", out], config);

    expect(readFileSync(out, "utf8")).toBe("hello-plugin ran");
  });

  it("short-circuits a command whose required capability is unavailable", async () => {
    const config = await loadConfig({ root: tmp });
    // The capability hook (prerun) runs in BaseCommand.init via the runner;
    // with no provider registered, `github` is unavailable and the command
    // must error before its run() body executes.
    await expect(run(["guarded"], config)).rejects.toThrow();
  });
});
