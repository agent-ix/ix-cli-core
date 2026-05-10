import { isValidPluginId, validatePluginIdOrThrow } from "../config/paths.js";
import {
  getRegisteredPlugin,
  registerPlugin,
  type RegisterResult,
} from "../config/registry.js";
import {
  registerSecretsForPlugin,
  type SecretRegisterResult,
} from "../secrets/registry.js";
import type { IxPlugin, RegisteredIxPlugin } from "./types.js";

export type IxPluginRegistrationFailureReason =
  | "invalid-plugin-id"
  | "non-strict-schema"
  | "duplicate-id"
  | "secret-registration-failed";

export type IxPluginRegistrationResult =
  | {
      ok: true;
      kind: "registered" | "idempotent";
      plugin: RegisteredIxPlugin;
      config?: Extract<RegisterResult, { ok: true }>;
      secrets: SecretRegisterResult[];
    }
  | {
      ok: false;
      kind: IxPluginRegistrationFailureReason;
      pluginId: string;
      detail: string;
      config?: RegisterResult;
      secrets?: SecretRegisterResult[];
    };

const ixPlugins = new Map<string, RegisteredIxPlugin>();

export function registerIxPlugin(plugin: IxPlugin): IxPluginRegistrationResult {
  if (!isValidPluginId(plugin.id)) {
    return {
      ok: false,
      kind: "invalid-plugin-id",
      pluginId: plugin.id,
      detail: `invalid plugin id ${JSON.stringify(plugin.id)}`,
    };
  }

  if (plugin.configSchema && !isStrictZodObject(plugin.configSchema)) {
    return {
      ok: false,
      kind: "non-strict-schema",
      pluginId: plugin.id,
      detail: `plugin ${plugin.id} configSchema must be a strict Zod object`,
    };
  }

  const existing = ixPlugins.get(plugin.id);
  if (existing) {
    const normalized = normalizeIxPlugin(plugin);
    if (registeredPluginsEqual(existing, normalized)) {
      return {
        ok: true,
        kind: "idempotent",
        plugin: existing,
        secrets: [],
      };
    }
    return {
      ok: false,
      kind: "duplicate-id",
      pluginId: plugin.id,
      detail: `plugin id ${plugin.id} is already registered`,
    };
  }

  let configResult: RegisterResult | undefined;
  let configSuccess: Extract<RegisterResult, { ok: true }> | undefined;
  if (plugin.configSchema) {
    configResult = registerPlugin({
      pluginId: plugin.id,
      schema: plugin.configSchema,
      envBindings: plugin.envBindings,
    });
    if (!configResult.ok) {
      return {
        ok: false,
        kind: "duplicate-id",
        pluginId: plugin.id,
        detail: `config registry rejected plugin ${plugin.id}: ${configResult.kind}`,
        config: configResult,
      };
    }
    configSuccess = configResult;
  } else {
    validatePluginIdOrThrow(plugin.id);
    if (getRegisteredPlugin(plugin.id)) {
      return {
        ok: false,
        kind: "duplicate-id",
        pluginId: plugin.id,
        detail: `config registry already contains plugin ${plugin.id}`,
      };
    }
  }

  const secretResults = registerSecretsForPlugin(
    plugin.id,
    plugin.secretsSchema ?? [],
  );
  const failedSecret = secretResults.find((result) => !result.ok);
  if (failedSecret) {
    return {
      ok: false,
      kind: "secret-registration-failed",
      pluginId: plugin.id,
      detail: `secret registry rejected plugin ${plugin.id}: ${failedSecret.kind}`,
      config: configResult,
      secrets: secretResults,
    };
  }

  const registered = normalizeIxPlugin(plugin);
  ixPlugins.set(plugin.id, registered);
  return {
    ok: true,
    kind: "registered",
    plugin: registered,
    config: configSuccess,
    secrets: secretResults,
  };
}

export function getRegisteredIxPlugin(
  pluginId: string,
): RegisteredIxPlugin | undefined {
  return ixPlugins.get(pluginId);
}

export function listRegisteredIxPlugins(): RegisteredIxPlugin[] {
  return Array.from(ixPlugins.values());
}

export function _resetIxPluginRegistryForTests(): void {
  ixPlugins.clear();
}

function normalizeIxPlugin(plugin: IxPlugin): RegisteredIxPlugin {
  return {
    id: plugin.id,
    commands: plugin.commands ?? [],
    capabilities: plugin.capabilities ?? [],
  };
}

function registeredPluginsEqual(
  a: RegisteredIxPlugin,
  b: RegisteredIxPlugin,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isStrictZodObject(schema: IxPlugin["configSchema"]): boolean {
  const def = schema?._def as
    | { catchall?: { def?: { type?: string }; _def?: { type?: string } } }
    | undefined;
  const catchall = def?.catchall;
  return (
    catchall !== undefined &&
    (catchall.def?.type === "never" || catchall._def?.type === "never")
  );
}
