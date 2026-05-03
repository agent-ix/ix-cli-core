import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ConfigParseError,
  ConfigSchemaError,
  ConfigService,
  configPathFor,
  configRoot,
  CORE_PLUGIN_ID,
  InvalidPluginIdError,
  isValidPluginId,
} from "../src/index.js";

const LocalSchema = z
  .object({
    cluster: z
      .object({
        defaultTags: z.array(z.string()).default(["ix-core"]),
        skipApps: z.array(z.string()).default([]),
      })
      .strict()
      .default({ defaultTags: ["ix-core"], skipApps: [] }),
    concurrency: z
      .object({
        dockerPull: z.number().int().min(1).default(3),
      })
      .strict()
      .default({ dockerPull: 3 }),
  })
  .strict();

const CoreSchema = z
  .object({
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    theme: z.enum(["auto", "light", "dark"]).default("auto"),
  })
  .strict();

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-cfg-"));
  process.env.XDG_CONFIG_HOME = dir;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("plugin id validation — FR-013-AC-7", () => {
  it("accepts well-formed lowercase ids", () => {
    expect(isValidPluginId("local")).toBe(true);
    expect(isValidPluginId("ix-cli-elements")).toBe(true);
    expect(isValidPluginId("a1")).toBe(true);
  });

  it("rejects empty, uppercase, leading-digit, and path-traversal ids", () => {
    expect(isValidPluginId("")).toBe(false);
    expect(isValidPluginId("Foo")).toBe(false);
    expect(isValidPluginId("1foo")).toBe(false);
    expect(isValidPluginId("a/b")).toBe(false);
    expect(isValidPluginId("..")).toBe(false);
    expect(isValidPluginId("../etc")).toBe(false);
    expect(isValidPluginId("a".repeat(65))).toBe(false);
  });

  it("configPathFor() throws InvalidPluginIdError for malformed ids", () => {
    expect(() => configPathFor("..")).toThrow(InvalidPluginIdError);
    expect(() => configPathFor("")).toThrow(InvalidPluginIdError);
  });
});

describe("config path resolution — FR-010 file-layout carve-out (B3)", () => {
  it("core resolves to <root>/config.yaml", () => {
    expect(configPathFor(CORE_PLUGIN_ID)).toBe(
      join(configRoot(), "config.yaml"),
    );
  });

  it("non-core resolves to <root>/config.d/<id>.yaml", () => {
    expect(configPathFor("local")).toBe(
      join(configRoot(), "config.d", "local.yaml"),
    );
    expect(configPathFor("elements")).toBe(
      join(configRoot(), "config.d", "elements.yaml"),
    );
  });

  it("honors XDG_CONFIG_HOME", () => {
    expect(configRoot()).toBe(join(dir, "ix"));
    expect(configPathFor("local")).toBe(
      join(dir, "ix", "config.d", "local.yaml"),
    );
    expect(configPathFor("core")).toBe(join(dir, "ix", "config.yaml"));
  });
});

describe("ConfigService.forPlugin — FR-010-AC-1 scoped reads", () => {
  it("reads only the requesting plugin's file", () => {
    // Pre-seed elements config; reading local should return defaults.
    const elementsPath = configPathFor("elements");
    writeFileSync(
      join(dir, "ix"),
      "",
      // Touch dir; we'll ensure parent below by creating elements file.
      { flag: "a" },
    );
    // The above is a no-op for files; create parent dirs explicitly:
    rmSync(join(dir, "ix"), { force: true });
    const localCfg = ConfigService.forPlugin("local", LocalSchema);
    localCfg.set({ cluster: { defaultTags: ["alpha", "beta"], skipApps: [] } });

    // Now write elements file by hand with garbage; local read must be unaffected.
    writeFileSync(elementsPath, "garbage: [unbalanced\n", { mode: 0o600 });

    const v = localCfg.get();
    expect(v.cluster.defaultTags).toEqual(["alpha", "beta"]);
    // No exception leaked from the (broken) elements file.
  });

  it("filePath returns the absolute path", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    expect(cfg.filePath()).toBe(configPathFor("local"));
    expect(cfg.filePath().startsWith(dir)).toBe(true);
  });
});

describe("ConfigService — FR-010-AC-2 atomic write + FR-010-AC-3 mode 0o600", () => {
  it("creates a 0o600 file via atomic temp+rename", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    cfg.set({ concurrency: { dockerPull: 7 } });
    const path = cfg.filePath();
    expect(existsSync(path)).toBe(true);
    const st = statSync(path);
    expect(st.mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toContain("dockerPull: 7");
  });

  it("re-set merges the existing file (does not lose unrelated keys)", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    cfg.set({ cluster: { defaultTags: ["alpha"], skipApps: [] } });
    cfg.set({ concurrency: { dockerPull: 9 } });
    const v = cfg.get();
    expect(v.cluster.defaultTags).toEqual(["alpha"]);
    expect(v.concurrency.dockerPull).toBe(9);
  });
});

describe("ConfigService — FR-010-AC-4 strict schema rejects unknown keys", () => {
  it("set() with an unknown top-level key throws ConfigSchemaError", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    expect(() =>
      cfg.set({ rogue: 1 } as unknown as Partial<z.infer<typeof LocalSchema>>),
    ).toThrow(ConfigSchemaError);
  });

  it("the failed set leaves the file absent on disk", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    expect(() =>
      cfg.set({ rogue: 1 } as unknown as Partial<z.infer<typeof LocalSchema>>),
    ).toThrow();
    expect(existsSync(cfg.filePath())).toBe(false);
  });

  it("set() with an unknown nested key throws ConfigSchemaError", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    expect(() =>
      cfg.set({
        cluster: { defaultTags: [], skipApps: [], rogue: 1 },
      } as unknown as Partial<z.infer<typeof LocalSchema>>),
    ).toThrow(ConfigSchemaError);
  });
});

describe("ConfigService — FR-010-AC-5 reset() returns to defaults", () => {
  it("reset() deletes the file; next get() returns schema defaults", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    cfg.set({ concurrency: { dockerPull: 9 } });
    expect(existsSync(cfg.filePath())).toBe(true);
    cfg.reset();
    expect(existsSync(cfg.filePath())).toBe(false);
    expect(cfg.get().concurrency.dockerPull).toBe(3);
  });

  it("reset() on absent file is a no-op", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    expect(() => cfg.reset()).not.toThrow();
  });
});

describe("ConfigService — get() returns schema defaults when file absent", () => {
  it("returns the full default object", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    const v = cfg.get();
    expect(v.cluster.defaultTags).toEqual(["ix-core"]);
    expect(v.cluster.skipApps).toEqual([]);
    expect(v.concurrency.dockerPull).toBe(3);
  });

  it("works for the core plugin too (writes ~/.config/ix/config.yaml)", () => {
    const cfg = ConfigService.forPlugin(CORE_PLUGIN_ID, CoreSchema);
    cfg.set({ logLevel: "debug" });
    expect(cfg.filePath()).toBe(join(dir, "ix", "config.yaml"));
    const st = statSync(cfg.filePath());
    expect(st.mode & 0o777).toBe(0o600);
    expect(cfg.get().logLevel).toBe("debug");
  });
});

describe("ConfigService — ConfigParseError on malformed YAML", () => {
  it("get() on a file with invalid YAML throws ConfigParseError naming plugin and path", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    cfg.set({ cluster: { defaultTags: ["a"], skipApps: [] } });
    writeFileSync(cfg.filePath(), "garbage: [unbalanced\n", { mode: 0o600 });
    let err: unknown;
    try {
      cfg.get();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigParseError);
    expect((err as ConfigParseError).pluginId).toBe("local");
    expect((err as ConfigParseError).filePath).toBe(cfg.filePath());
  });

  it("get() on a file whose top-level is not an object throws ConfigParseError", () => {
    const cfg = ConfigService.forPlugin("local", LocalSchema);
    // Write a YAML list at top level — invalid for our schema model.
    cfg.set({ cluster: { defaultTags: ["a"], skipApps: [] } });
    writeFileSync(cfg.filePath(), "- not\n- an\n- object\n", { mode: 0o600 });
    expect(() => cfg.get()).toThrow(ConfigParseError);
  });
});
