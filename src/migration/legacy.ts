import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { atomicWrite } from "../atomic/write.js";
import { configPathFor } from "../config/paths.js";
import type { SecretsService } from "../secrets/service.js";

const MARKER_VALUE = "legacy-v1";

export interface LegacyMigrationOptions {
  /** Override the legacy `~/.ix/config.yaml` path (tests). */
  legacyConfigPath?: string;
  /** Override the legacy `~/.config/ix-local/credentials.json` path (tests). */
  legacyCredentialsPath?: string;
  /** SecretsService used to persist the migrated GHCR token. */
  secretsService: SecretsService;
}

export interface LegacyMigrationReport {
  ranAt: number;
  /** True if the legacy config.yaml existed AND was successfully migrated. */
  configMigrated: boolean;
  /** True if the legacy credentials.json existed AND was successfully migrated. */
  credentialsMigrated: boolean;
  /** Skipped because the marker was already present (no work done). */
  skipped: boolean;
  /** Non-fatal warnings (malformed source, etc.). */
  warnings: string[];
}

/**
 * One-shot legacy migration (FR-017). Idempotent — second run detects the
 * `migratedFrom: legacy-v1` marker in `config.d/local.yaml` and returns
 * `{ skipped: true }` without touching legacy paths.
 *
 * Failures are non-fatal: a malformed legacy file aborts that source's
 * migration with a warning but does NOT throw to the calling command.
 * Plaintext legacy files are deleted only when their migration succeeds.
 */
export async function runLegacyMigration(
  opts: LegacyMigrationOptions,
): Promise<LegacyMigrationReport> {
  const legacyConfigPath =
    opts.legacyConfigPath ?? join(homedir(), ".ix", "config.yaml");
  const legacyCredsPath =
    opts.legacyCredentialsPath ??
    join(homedir(), ".config", "ix-local", "credentials.json");

  const localPath = configPathFor("local");
  const ranAt = Date.now();
  const warnings: string[] = [];

  // Idempotency: marker present → skip.
  if (existsMarker(localPath)) {
    return {
      ranAt,
      configMigrated: false,
      credentialsMigrated: false,
      skipped: true,
      warnings,
    };
  }

  // No sources at all → silent no-op (FR-017-AC-4).
  const haveConfig = existsSync(legacyConfigPath);
  const haveCreds = existsSync(legacyCredsPath);
  if (!haveConfig && !haveCreds) {
    return {
      ranAt,
      configMigrated: false,
      credentialsMigrated: false,
      skipped: false,
      warnings,
    };
  }

  let configMigrated = false;
  let credentialsMigrated = false;

  // 1. Migrate config.yaml top-level `cluster` and `concurrency` keys to
  //    `config.d/local.yaml`. Validation against the local plugin schema
  //    is the responsibility of `packages/local` when it registers its
  //    schema; here we only translate the on-disk shape and write the
  //    marker. If `config.d/local.yaml` already exists with a partial
  //    payload we merge the legacy keys in.
  if (haveConfig) {
    try {
      const raw = readFileSync(legacyConfigPath, "utf8");
      const parsed = parseYaml(raw);
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("legacy ~/.ix/config.yaml is not a YAML object");
      }
      const obj = parsed as Record<string, unknown>;
      const carry: Record<string, unknown> = {};
      if (obj.cluster !== undefined) carry.cluster = obj.cluster;
      if (obj.concurrency !== undefined) carry.concurrency = obj.concurrency;

      // Merge with any pre-existing local file; preserve unrelated keys.
      const current = readObjectOr({}, localPath);
      const merged = { ...current, ...carry, migratedFrom: MARKER_VALUE };
      writeYamlAtomically(localPath, merged);

      // Preserve a one-time backup of the legacy file rather than deleting it.
      try {
        renameSync(legacyConfigPath, `${legacyConfigPath}.migrated`);
      } catch (renameErr) {
        warnings.push(
          `legacy config migrated but rename to .migrated failed: ${(renameErr as Error).message}`,
        );
      }
      configMigrated = true;
    } catch (err) {
      warnings.push(
        `skipped legacy ~/.ix/config.yaml migration: ${(err as Error).message}`,
      );
    }
  } else {
    // Still write the marker so subsequent runs detect "migration considered" state.
    writeYamlAtomically(localPath, {
      ...readObjectOr({}, localPath),
      migratedFrom: MARKER_VALUE,
    });
  }

  // 2. Migrate credentials.json → secret `local.ghcr-token`.
  if (haveCreds) {
    try {
      const raw = readFileSync(legacyCredsPath, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        throw new Error(
          `legacy credentials.json is not valid JSON: ${(parseErr as Error).message}`,
        );
      }
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("legacy credentials.json top-level is not an object");
      }
      const creds = parsed as Record<string, unknown>;
      const token = creds.ghcr_token;
      if (typeof token === "string" && token.length > 0) {
        await opts.secretsService.set("local.ghcr-token", token);
        unlinkSync(legacyCredsPath);
        credentialsMigrated = true;
      } else {
        warnings.push(
          "legacy credentials.json has no 'ghcr_token' string; nothing to migrate",
        );
      }
    } catch (err) {
      warnings.push(
        `skipped legacy credentials.json migration: ${(err as Error).message}`,
      );
    }
  }

  return {
    ranAt,
    configMigrated,
    credentialsMigrated,
    skipped: false,
    warnings,
  };
}

function existsMarker(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const obj = parseYaml(readFileSync(path, "utf8"));
    if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
      return false;
    }
    return (obj as Record<string, unknown>).migratedFrom === MARKER_VALUE;
  } catch {
    return false;
  }
}

function readObjectOr(
  fallback: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  if (!existsSync(path)) return fallback;
  try {
    const obj = parseYaml(readFileSync(path, "utf8"));
    if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
      return fallback;
    }
    return obj as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function writeYamlAtomically(
  path: string,
  value: Record<string, unknown>,
): void {
  // Ensure parent exists.
  const parent = path.slice(0, path.lastIndexOf("/"));
  if (parent && !existsSync(parent)) {
    // Lazy require to avoid a fixed import we'd duplicate.
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  } else if (parent) {
    try {
      const st = statSync(parent);
      if (!st.isDirectory()) throw new Error(`expected directory at ${parent}`);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") {
        mkdirSync(parent, { recursive: true, mode: 0o700 });
      }
    }
  }
  const yaml = stringifyYaml(value, { lineWidth: 0 });
  atomicWrite(path, yaml);
}
