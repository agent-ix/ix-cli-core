import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  MemoryBackend,
  registerSecretsForPlugin,
  runLegacyMigration,
  SecretsService,
} from "../src/index.js";
import { _resetSecretsRegistryForTests } from "../src/secrets/registry.js";

let configHome: string;
let legacyDir: string;
let secretsService: SecretsService;
let backend: MemoryBackend;

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "ix-mig-cfg-"));
  legacyDir = mkdtempSync(join(tmpdir(), "ix-mig-leg-"));
  process.env.XDG_CONFIG_HOME = configHome;
  _resetSecretsRegistryForTests();
  registerSecretsForPlugin("local", [
    { name: "ghcr-token", description: "GHCR PAT" },
  ]);
  backend = new MemoryBackend("keyring");
  secretsService = new SecretsService({
    mode: "keyring",
    backends: new Map([["keyring", backend]]),
    env: {},
  });
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(configHome, { recursive: true, force: true });
  rmSync(legacyDir, { recursive: true, force: true });
  _resetSecretsRegistryForTests();
});

function legacyConfigPath(): string {
  return join(legacyDir, "config.yaml");
}

function legacyCredsPath(): string {
  const dir = join(legacyDir, "credentials");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, "credentials.json");
}

describe("runLegacyMigration — FR-017-AC-1 happy path", () => {
  it("migrates both legacy sources and removes/renames them", async () => {
    const cfg = legacyConfigPath();
    const creds = legacyCredsPath();
    writeFileSync(
      cfg,
      'cluster:\n  defaultTags: ["ix-core"]\nconcurrency:\n  dockerPull: 5\n',
    );
    writeFileSync(creds, JSON.stringify({ ghcr_token: "ghp_legacy_value" }));

    const report = await runLegacyMigration({
      legacyConfigPath: cfg,
      legacyCredentialsPath: creds,
      secretsService,
    });

    expect(report.skipped).toBe(false);
    expect(report.configMigrated).toBe(true);
    expect(report.credentialsMigrated).toBe(true);
    expect(report.warnings).toEqual([]);

    // Local config landed.
    const local = parseYaml(
      readFileSync(join(configHome, "ix", "config.d", "local.yaml"), "utf8"),
    );
    expect(local.cluster.defaultTags).toEqual(["ix-core"]);
    expect(local.concurrency.dockerPull).toBe(5);
    expect(local.migratedFrom).toBe("legacy-v1");

    // Token landed in the secrets backend.
    expect(await backend.get("local.ghcr-token")).toBe("ghp_legacy_value");

    // Legacy paths handled correctly.
    expect(existsSync(creds)).toBe(false);
    expect(existsSync(cfg)).toBe(false);
    expect(existsSync(`${cfg}.migrated`)).toBe(true);
  });
});

describe("runLegacyMigration — FR-017-AC-2 idempotency", () => {
  it("second run is a skipped no-op when the marker is present", async () => {
    const cfg = legacyConfigPath();
    const creds = legacyCredsPath();
    writeFileSync(cfg, 'cluster:\n  defaultTags: ["ix-core"]\n');
    writeFileSync(creds, JSON.stringify({ ghcr_token: "v" }));

    await runLegacyMigration({
      legacyConfigPath: cfg,
      legacyCredentialsPath: creds,
      secretsService,
    });

    // Re-create the legacy files; the marker must still trip "skip".
    writeFileSync(cfg, 'cluster:\n  defaultTags: ["new"]\n');
    writeFileSync(creds, JSON.stringify({ ghcr_token: "new-token" }));

    const report = await runLegacyMigration({
      legacyConfigPath: cfg,
      legacyCredentialsPath: creds,
      secretsService,
    });

    expect(report.skipped).toBe(true);
    expect(report.configMigrated).toBe(false);
    expect(report.credentialsMigrated).toBe(false);
    // Re-created legacy files are NOT touched by the skipped run.
    expect(existsSync(cfg)).toBe(true);
    expect(existsSync(creds)).toBe(true);
  });
});

describe("runLegacyMigration — FR-017-AC-3 malformed source preserves legacy", () => {
  it("malformed legacy YAML produces a warning and leaves the legacy file in place", async () => {
    const cfg = legacyConfigPath();
    writeFileSync(cfg, "garbage: [unbalanced\n");

    const report = await runLegacyMigration({
      legacyConfigPath: cfg,
      legacyCredentialsPath: join(legacyDir, "absent.json"),
      secretsService,
    });

    expect(report.configMigrated).toBe(false);
    expect(report.warnings.some((w) => w.includes("config.yaml"))).toBe(true);
    // Legacy preserved.
    expect(existsSync(cfg)).toBe(true);
    expect(existsSync(`${cfg}.migrated`)).toBe(false);
  });

  it("malformed credentials JSON produces a warning and leaves credentials.json in place", async () => {
    const creds = legacyCredsPath();
    writeFileSync(creds, "{ this is not json");

    const report = await runLegacyMigration({
      legacyConfigPath: join(legacyDir, "absent.yaml"),
      legacyCredentialsPath: creds,
      secretsService,
    });

    expect(report.credentialsMigrated).toBe(false);
    expect(report.warnings.some((w) => w.includes("credentials.json"))).toBe(
      true,
    );
    expect(existsSync(creds)).toBe(true);
  });
});

describe("runLegacyMigration — FR-017-AC-4 no legacy → silent no-op", () => {
  it("returns a report with skipped=false and no migration; no files created beyond the marker", async () => {
    const report = await runLegacyMigration({
      legacyConfigPath: join(legacyDir, "absent.yaml"),
      legacyCredentialsPath: join(legacyDir, "absent.json"),
      secretsService,
    });
    expect(report.skipped).toBe(false);
    expect(report.configMigrated).toBe(false);
    expect(report.credentialsMigrated).toBe(false);
    expect(report.warnings).toEqual([]);
  });
});

describe("runLegacyMigration — FR-017-AC-6 no plaintext leak", () => {
  it("the migrated GHCR token is never written to a config or marker file", async () => {
    const cfg = legacyConfigPath();
    const creds = legacyCredsPath();
    const tokenValue = "ghp_NEVER_LEAK_THIS_VALUE_4242";
    writeFileSync(cfg, 'cluster:\n  defaultTags: ["ix-core"]\n');
    writeFileSync(creds, JSON.stringify({ ghcr_token: tokenValue }));

    await runLegacyMigration({
      legacyConfigPath: cfg,
      legacyCredentialsPath: creds,
      secretsService,
    });

    // Walk every file under the new configHome and verify the token is absent.
    const fs = await import("node:fs");
    const stack = [join(configHome, "ix")];
    while (stack.length > 0) {
      const here = stack.pop()!;
      const entries = fs.readdirSync(here, { withFileTypes: true });
      for (const e of entries) {
        const p = join(here, e.name);
        if (e.isDirectory()) {
          stack.push(p);
          continue;
        }
        const bytes = fs.readFileSync(p);
        expect(bytes.includes(Buffer.from(tokenValue, "utf8"))).toBe(false);
      }
    }
    // And the secret really did land in the backend.
    expect(await backend.get("local.ghcr-token")).toBe(tokenValue);
  });
});

describe("runLegacyMigration — pre-existing local file is preserved", () => {
  it("merges legacy keys into an existing local.yaml without losing unrelated keys", async () => {
    // Pre-seed local.yaml with an unrelated key that the merge must preserve.
    const ixDir = join(configHome, "ix", "config.d");
    mkdirSync(ixDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(ixDir, "local.yaml"),
      "unrelated:\n  preserved: true\n",
      { mode: 0o600 },
    );

    const cfg = legacyConfigPath();
    writeFileSync(cfg, 'cluster:\n  defaultTags: ["ix-core"]\n');

    await runLegacyMigration({
      legacyConfigPath: cfg,
      legacyCredentialsPath: join(legacyDir, "absent.json"),
      secretsService,
    });

    const merged = parseYaml(
      readFileSync(join(ixDir, "local.yaml"), "utf8"),
    ) as Record<string, unknown>;
    expect(merged.unrelated).toEqual({ preserved: true });
    expect(merged.cluster).toEqual({ defaultTags: ["ix-core"] });
    expect(merged.migratedFrom).toBe("legacy-v1");
  });
});
