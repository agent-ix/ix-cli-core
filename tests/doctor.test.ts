import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigService, doctor } from "../src/index.js";

const LocalSchema = z
  .object({
    cluster: z
      .object({
        defaultTags: z.array(z.string()).default(["ix-core"]),
      })
      .strict()
      .default({ defaultTags: ["ix-core"] }),
  })
  .strict();

const ElementsSchema = z
  .object({
    taps: z.array(z.string()).default([]),
  })
  .strict();

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-doctor-"));
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("doctor — FR-011-AC-3 reports per-plugin status without throwing", () => {
  it("returns valid entries for plugins with no file (defaults applied)", () => {
    ConfigService.forPlugin("local", LocalSchema);
    ConfigService.forPlugin("elements", ElementsSchema);
    const r = doctor();
    const e = r.entries.filter((x) =>
      ["local", "elements"].includes(x.pluginId),
    );
    expect(e).toHaveLength(2);
    expect(e.every((x) => x.kind === "valid")).toBe(true);
  });

  it("reports invalid for a malformed file but does not throw", () => {
    const local = ConfigService.forPlugin("local", LocalSchema);
    ConfigService.forPlugin("elements", ElementsSchema);

    // Cause the local file to be malformed YAML.
    local.set({ cluster: { defaultTags: ["a"] } });
    writeFileSync(local.filePath(), "garbage: [unbalanced\n", { mode: 0o600 });

    const r = doctor();
    const localEntry = r.entries.find((x) => x.pluginId === "local");
    const elementsEntry = r.entries.find((x) => x.pluginId === "elements");
    expect(localEntry?.kind).toBe("invalid");
    if (localEntry?.kind === "invalid") {
      expect(localEntry.errors.length).toBeGreaterThan(0);
    }
    expect(elementsEntry?.kind).toBe("valid");
  });

  it("flags unregistered files in config.d/ as kind=unregistered", () => {
    ConfigService.forPlugin("local", LocalSchema);
    // Create a stray file in config.d/ for a plugin nobody registered.
    const strayDir = join(dir, "ix", "config.d");
    mkdirSync(strayDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(strayDir, "stray.yaml"), "x: 1\n", { mode: 0o600 });

    const r = doctor();
    const stray = r.entries.find((x) => x.pluginId === "stray");
    expect(stray?.kind).toBe("unregistered");
  });

  it("output is byte-stable: entries sorted by pluginId", () => {
    ConfigService.forPlugin("zeta", ElementsSchema);
    ConfigService.forPlugin("alpha", ElementsSchema);
    ConfigService.forPlugin("beta", ElementsSchema);
    const r = doctor();
    const ids = r.entries.map((e) => e.pluginId);
    expect(ids).toEqual([...ids].sort());
  });
});
