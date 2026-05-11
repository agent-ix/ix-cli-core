import type { ZodObject, ZodRawShape } from "zod";

import { isValidPluginId } from "../config/paths.js";
import { registerPlugin } from "../config/registry.js";
import { registerSecretsForPlugin } from "../secrets/registry.js";
import type { SecretDeclaration } from "../secrets/types.js";

/**
 * Convention shape exposed by an IX-compatible plugin from its package
 * main as the named export `ixSchema`. See FR-025.
 *
 * The host's `init` hook walks the oclif-loaded plugin list, reads each
 * plugin's `ixSchema`, and registers schemas with `ConfigService` /
 * `SecretsService` keyed by `ixSchema.id` when provided, otherwise a
 * safe id derived from the plugin's npm package name.
 */
export interface IxPluginSchema {
  /** Safe config/secrets namespace. Defaults to a sanitized package name. */
  id?: string;
  /** Strict Zod object describing the plugin's persistent config. */
  config?: ZodObject<ZodRawShape>;
  /** Secret declarations registered under `<plugin-id>.<secret-name>`. */
  secrets?: SecretDeclaration[];
  /** Map of config key → env-var name for env-binding overrides. */
  env?: Record<string, string>;
}

/** Registered entry kept in-process by `registerPluginSchema`. */
export interface RegisteredPluginSchema {
  packageName: string;
  schema: IxPluginSchema;
}

export type PluginSchemaRegistrationFailureReason =
  | "invalid-package-name"
  | "invalid-plugin-id"
  | "non-strict-schema"
  | "duplicate-registration";

export type PluginSchemaRegistrationResult =
  | {
      ok: true;
      kind: "registered" | "idempotent";
      entry: RegisteredPluginSchema;
    }
  | {
      ok: false;
      kind: PluginSchemaRegistrationFailureReason;
      packageName: string;
      detail: string;
    };

const registry = new Map<string, RegisteredPluginSchema>();

/**
 * Register a plugin's `ixSchema` under its npm package name.
 *
 * - `packageName` must be a non-empty string and is used as the oclif
 *   install/load identity.
 * - `schema.id`, if present, is the config/secrets namespace. Without it,
 *   a safe namespace is derived from the package name.
 * - `schema.config`, if present, must be a strict Zod object
 *   (`z.object({...}).strict()`); non-strict schemas are rejected.
 * - Duplicate registrations preserve the first entry and return a
 *   non-throwing failure result.
 *
 * This function also wires the schema through the existing
 * `registerPlugin` / `registerSecretsForPlugin` APIs so `ix config` and
 * `ix secrets` can see oclif plugins immediately after host bootstrap.
 */
export function registerPluginSchema(
  packageName: string,
  schema: IxPluginSchema,
): PluginSchemaRegistrationResult {
  if (typeof packageName !== "string" || packageName.length === 0) {
    return {
      ok: false,
      kind: "invalid-package-name",
      packageName,
      detail: `package name must be a non-empty string, got ${JSON.stringify(packageName)}`,
    };
  }

  const pluginId = schema.id ?? pluginIdFromPackageName(packageName);
  if (!isValidPluginId(pluginId)) {
    return {
      ok: false,
      kind: "invalid-plugin-id",
      packageName,
      detail: `ixSchema id for ${packageName} must match /^[a-z][a-z0-9-]*$/`,
    };
  }

  if (schema.config && !isStrictZodObject(schema.config)) {
    return {
      ok: false,
      kind: "non-strict-schema",
      packageName,
      detail: `ixSchema.config for ${packageName} must be a strict Zod object (.strict())`,
    };
  }

  const existing = registry.get(packageName);
  if (existing) {
    return {
      ok: false,
      kind: "duplicate-registration",
      packageName,
      detail: `plugin schema for ${packageName} is already registered`,
    };
  }

  if (schema.config) {
    const result = registerPlugin({
      pluginId,
      schema: schema.config,
      envBindings: schema.env,
    });
    if (!result.ok) {
      return {
        ok: false,
        kind: "duplicate-registration",
        packageName,
        detail: `config registry already contains plugin id ${pluginId}`,
      };
    }
  }

  if (schema.secrets) {
    const failed = registerSecretsForPlugin(pluginId, schema.secrets).find(
      (result) => !result.ok,
    );
    if (failed) {
      return {
        ok: false,
        kind: "duplicate-registration",
        packageName,
        detail: `secret registry rejected plugin id ${pluginId}: ${failed.kind}`,
      };
    }
  }

  const entry: RegisteredPluginSchema = { packageName, schema };
  registry.set(packageName, entry);
  return { ok: true, kind: "registered", entry };
}

export function getRegisteredPluginSchema(
  packageName: string,
): RegisteredPluginSchema | undefined {
  return registry.get(packageName);
}

export function listRegisteredPluginSchemas(): RegisteredPluginSchema[] {
  return Array.from(registry.values());
}

export function _resetPluginSchemaRegistryForTests(): void {
  registry.clear();
}

function isStrictZodObject(schema: ZodObject<ZodRawShape>): boolean {
  const def = schema._def as
    | { catchall?: { def?: { type?: string }; _def?: { type?: string } } }
    | undefined;
  const catchall = def?.catchall;
  return (
    catchall !== undefined &&
    (catchall.def?.type === "never" || catchall._def?.type === "never")
  );
}

function pluginIdFromPackageName(packageName: string): string {
  const bare = packageName.startsWith("@")
    ? (packageName.split("/").at(-1) ?? packageName)
    : packageName;
  return bare
    .replace(/^ix-cli-/, "")
    .replace(/^workflow-cli-plugin$/, "workflow")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .toLowerCase();
}
