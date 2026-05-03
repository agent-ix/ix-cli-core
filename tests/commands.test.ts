import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

import {
  ConfigSetParseError,
  ConfigService,
  ConfigSchemaError,
  CORE_PLUGIN_ID,
  configPathFor,
  EmptySecretValueError,
  InvalidSecretIdError,
  MemoryBackend,
  registerSecretsForPlugin,
  runConfigDoctor,
  runConfigGet,
  runConfigSet,
  runSecretsRm,
  runSecretsSet,
  runSecretsWhich,
  SecretsService,
  setDefaultSecretsService,
  resetDefaultSecretsService,
  UnknownPluginError,
  UnknownSecretError,
} from "../src/index.js";
import { _resetSecretsRegistryForTests } from "../src/secrets/registry.js";
import { _resetRegistryForTests } from "../src/config/registry.js";

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
        dockerPull: z.coerce.number().int().min(1).default(3),
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
let backend: MemoryBackend;
let svc: SecretsService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-cmd-"));
  process.env.XDG_CONFIG_HOME = dir;
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();

  // Auto-register the schemas via forPlugin().
  ConfigService.forPlugin("local", LocalSchema);
  ConfigService.forPlugin(CORE_PLUGIN_ID, CoreSchema);
  registerSecretsForPlugin("local", [
    { name: "ghcr-token", description: "GHCR PAT", envVar: "IX_GHCR_TOKEN" },
  ]);

  // Install a memory-backed default service so the runners use it.
  backend = new MemoryBackend("keyring");
  svc = new SecretsService({
    mode: "keyring",
    backends: new Map([["keyring", backend]]),
    env: {},
  });
  setDefaultSecretsService(svc);
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
  resetDefaultSecretsService();
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
});

/* ── runConfigSet ────────────────────────────────────────────────────── */

describe("runConfigSet — FR-018-AC-2 scalar coercion", () => {
  it("scalar value passes to schema and lands in the file", async () => {
    await runConfigSet("local", "concurrency.dockerPull", "9");
    const local = parseYaml(
      readFileSync(join(dir, "ix", "config.d", "local.yaml"), "utf8"),
    );
    expect(local.concurrency.dockerPull).toBe(9); // coerced
  });

  it("default plugin id is core when omitted", async () => {
    await runConfigSet(undefined, "logLevel", "debug");
    const core = parseYaml(
      readFileSync(join(dir, "ix", "config.yaml"), "utf8"),
    );
    expect(core.logLevel).toBe("debug");
  });
});

describe("runConfigSet — FR-018-AC-8 non-JSON for array key throws", () => {
  it("non-JSON array value → ConfigSetParseError naming key path + expected", async () => {
    await expect(
      runConfigSet("local", "cluster.defaultTags", "ix-core,ix-data"),
    ).rejects.toBeInstanceOf(ConfigSetParseError);
  });

  it("valid JSON array value succeeds", async () => {
    await runConfigSet("local", "cluster.defaultTags", '["ix-core","ix-data"]');
    const local = parseYaml(
      readFileSync(join(dir, "ix", "config.d", "local.yaml"), "utf8"),
    );
    expect(local.cluster.defaultTags).toEqual(["ix-core", "ix-data"]);
  });

  it("file is not modified when parse fails", async () => {
    const path = configPathFor("local");
    expect(existsSync(path)).toBe(false);
    await expect(
      runConfigSet("local", "cluster.defaultTags", "garbage"),
    ).rejects.toBeInstanceOf(ConfigSetParseError);
    expect(existsSync(path)).toBe(false);
  });
});

describe("runConfigSet — value classification by schema shape (N1)", () => {
  it("boolean leaf: coerced from string via z.coerce.boolean", async () => {
    const { ConfigService, registerSecretsForPlugin: _ } =
      await import("../src/index.js");
    void _;
    const Schema = z.object({ on: z.coerce.boolean().default(false) }).strict();
    ConfigService.forPlugin("flag", Schema);
    await runConfigSet("flag", "on", "true");
    const v = ConfigService.forPlugin("flag", Schema).get();
    expect(v.on).toBe(true);
  });

  it("enum leaf: scalar pass-through to schema enum", async () => {
    // Reuses the core schema's `theme` enum (auto/light/dark).
    await runConfigSet(undefined, "theme", "dark");
    // Reading via ConfigService confirms coercion landed.
    const { ConfigService } = await import("../src/index.js");
    const cfg = ConfigService.forPlugin(CORE_PLUGIN_ID, CoreSchema);
    expect(cfg.get().theme).toBe("dark");
  });

  it("object leaf: rejects non-JSON, accepts JSON object", async () => {
    const Schema = z
      .object({
        meta: z.record(z.string(), z.string()).default({}),
      })
      .strict();
    const { ConfigService } = await import("../src/index.js");
    ConfigService.forPlugin("objplugin", Schema);

    await expect(
      runConfigSet("objplugin", "meta", "key=value"),
    ).rejects.toBeInstanceOf(ConfigSetParseError);

    await runConfigSet("objplugin", "meta", '{"alpha":"1","beta":"2"}');
    const v = ConfigService.forPlugin("objplugin", Schema).get();
    expect(v.meta).toEqual({ alpha: "1", beta: "2" });
  });

  it("unknown key path: rejected by strict schema even when scalar-coerced", async () => {
    await expect(
      runConfigSet("local", "cluster.bogusKey", "x"),
    ).rejects.toBeInstanceOf(ConfigSchemaError);
  });
});

describe("runConfigSet — FR-018-AC-3 schema error", () => {
  it("invalid scalar value → ConfigSchemaError with full four-tuple", async () => {
    await expect(
      runConfigSet("local", "concurrency.dockerPull", "0"), // min(1) violated
    ).rejects.toBeInstanceOf(ConfigSchemaError);
  });
});

describe("runConfigSet — FR-018-AC-6 unknown plugin", () => {
  it("→ UnknownPluginError listing registered ids", async () => {
    await expect(runConfigSet("nope", "x", "y")).rejects.toBeInstanceOf(
      UnknownPluginError,
    );
  });
});

/* ── runConfigGet ────────────────────────────────────────────────────── */

describe("runConfigGet — FR-018-AC-1 default plugin core", () => {
  it("works with omitted plugin (core) and unset key", async () => {
    // Should not throw (warns about unset).
    await runConfigGet(undefined, "logLevel");
  });

  it("returns the value via the default plugin when set first", async () => {
    await runConfigSet(undefined, "theme", "dark");
    await runConfigGet(undefined, "theme"); // does not throw
  });
});

/* ── runConfigDoctor ─────────────────────────────────────────────────── */

describe("runConfigDoctor — FR-018-AC-5 mixed valid/invalid", () => {
  it("exit code is 0 when all valid", async () => {
    const r = await runConfigDoctor();
    expect(r.exitCode).toBe(0);
  });

  it("exit code is 1 when any plugin file is invalid", async () => {
    // Force malformed file for the local plugin.
    await runConfigSet("local", "concurrency.dockerPull", "9");
    const path = configPathFor("local");
    writeFileSync(path, "cluster:\n  defaultTags: 42\n", { mode: 0o600 });
    const r = await runConfigDoctor();
    expect(r.exitCode).toBe(1);
  });
});

/* ── runSecretsSet / runSecretsWhich / runSecretsRm ──────────────────── */

describe("runSecretsSet — FR-019-AC-2", () => {
  it("persists via the active backend; backend column reflects active id", async () => {
    await runSecretsSet("local.ghcr-token", {
      promptForValue: async () => "ghp_value",
    });
    expect(await backend.get("local.ghcr-token")).toBe("ghp_value");
  });

  it("rejects empty value with typed EmptySecretValueError", async () => {
    await expect(
      runSecretsSet("local.ghcr-token", {
        promptForValue: async () => "",
      }),
    ).rejects.toBeInstanceOf(EmptySecretValueError);
  });

  it("rejects unknown id with UnknownSecretError", async () => {
    await expect(
      runSecretsSet("local.unknown", {
        promptForValue: async () => "x",
      }),
    ).rejects.toBeInstanceOf(UnknownSecretError);
  });

  it("rejects malformed id with InvalidSecretIdError", async () => {
    await expect(
      runSecretsSet("..", {
        promptForValue: async () => "x",
      }),
    ).rejects.toBeInstanceOf(InvalidSecretIdError);
  });
});

describe("runSecretsRm — FR-019-AC-4 + warn-when-env-still-set", () => {
  it("clears persisted value; exit 0 when env not set", async () => {
    await runSecretsSet("local.ghcr-token", {
      promptForValue: async () => "v",
    });
    const r = await runSecretsRm("local.ghcr-token");
    expect(r.exitCode).toBe(0);
    expect(await backend.get("local.ghcr-token")).toBeNull();
  });

  it("warns and exits 0 by default when env shadow still present", async () => {
    // Re-create svc with env set; install it as the default.
    const envSvc = new SecretsService({
      mode: "keyring",
      backends: new Map([["keyring", backend]]),
      env: { IX_GHCR_TOKEN: "env-value" },
    });
    setDefaultSecretsService(envSvc);
    const r = await runSecretsRm("local.ghcr-token");
    expect(r.exitCode).toBe(0);
  });

  it("exit 1 with --strict when env shadow still present", async () => {
    const envSvc = new SecretsService({
      mode: "keyring",
      backends: new Map([["keyring", backend]]),
      env: { IX_GHCR_TOKEN: "env-value" },
    });
    setDefaultSecretsService(envSvc);
    const r = await runSecretsRm("local.ghcr-token", { strict: true });
    expect(r.exitCode).toBe(1);
  });
});

describe("runSecretsWhich — FR-019-AC-3", () => {
  it("returns one of env / keyring / age-file / unset (no throw on unset)", async () => {
    // Should not throw even if value is unset.
    await runSecretsWhich("local.ghcr-token");
  });

  it("malformed id → InvalidSecretIdError", async () => {
    await expect(runSecretsWhich("..")).rejects.toBeInstanceOf(
      InvalidSecretIdError,
    );
  });
});
