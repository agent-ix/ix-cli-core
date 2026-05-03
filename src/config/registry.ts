import type { ZodObject, ZodRawShape } from "zod";

import type { ConfigIssue } from "./errors.js";

/**
 * Module-level registry of plugin schemas, env bindings, and recent
 * incidents. `ConfigService.forPlugin(...)` auto-registers; `doctor()`
 * walks this registry plus the on-disk `config.d/` to produce reports.
 */

export interface RegisteredPlugin {
  pluginId: string;
  schema: ZodObject<ZodRawShape>;
  envBindings?: Record<string, string>; // keyPath → env var name
}

export interface ConfigIncident {
  pluginId: string;
  filePath: string;
  kind: "parse" | "schema" | "io";
  detail: string;
  issues?: ConfigIssue[];
  observedAt: number; // epoch ms
}

/**
 * Outcome of a `registerPlugin` call.
 *
 * - `registered`: this is the first registration for this plugin id.
 * - `idempotent`: the plugin id is already registered with the SAME schema
 *   reference; the call is a safe no-op (same plugin re-running its
 *   forPlugin(...) initialiser, etc.).
 * - `duplicate-id`: the plugin id is already registered with a DIFFERENT
 *   schema. The first registration is preserved; the new attempt is
 *   rejected. Per FR-013-AC-3 the caller (init hook) is responsible for
 *   logging and recording an incident.
 */
export type RegisterResult =
  | { ok: true; kind: "registered"; entry: RegisteredPlugin }
  | { ok: true; kind: "idempotent"; entry: RegisteredPlugin }
  | {
      ok: false;
      kind: "duplicate-id";
      existing: RegisteredPlugin;
      attempted: RegisteredPlugin;
    };

const plugins = new Map<string, RegisteredPlugin>();
const incidents: ConfigIncident[] = [];

/**
 * Register a plugin's schema and env bindings. Implements FR-013-AC-3
 * first-wins semantics: a second call with the same id but a different
 * schema is rejected; with the same schema reference, it's idempotent.
 *
 * Callers that want strict-mode rejection (e.g. the apps/ix init hook)
 * should inspect the result and log+record an incident on
 * `kind === "duplicate-id"`.
 */
export function registerPlugin(plugin: RegisteredPlugin): RegisterResult {
  const existing = plugins.get(plugin.pluginId);
  if (existing) {
    // Idempotent path: same schema reference (typically the same plugin
    // re-running forPlugin(...) within a single process).
    if (existing.schema === plugin.schema) {
      // Refresh envBindings if the caller passed a new map — they're not
      // structural identity, and updating them is a benign extension.
      if (plugin.envBindings && existing.envBindings !== plugin.envBindings) {
        existing.envBindings = plugin.envBindings;
      }
      return { ok: true, kind: "idempotent", entry: existing };
    }
    return {
      ok: false,
      kind: "duplicate-id",
      existing,
      attempted: plugin,
    };
  }
  plugins.set(plugin.pluginId, plugin);
  return { ok: true, kind: "registered", entry: plugin };
}

export function getRegisteredPlugin(
  pluginId: string,
): RegisteredPlugin | undefined {
  return plugins.get(pluginId);
}

export function listRegisteredPlugins(): RegisteredPlugin[] {
  return Array.from(plugins.values());
}

export function recordIncident(
  incident: Omit<ConfigIncident, "observedAt">,
): void {
  incidents.push({ ...incident, observedAt: Date.now() });
}

export function listIncidents(): ConfigIncident[] {
  return [...incidents];
}

export function clearIncidentsForPlugin(pluginId: string): void {
  for (let i = incidents.length - 1; i >= 0; i--) {
    if (incidents[i].pluginId === pluginId) incidents.splice(i, 1);
  }
}

/**
 * Test-only: reset the registry between tests. Not exported from the
 * public package entrypoint.
 */
export function _resetRegistryForTests(): void {
  plugins.clear();
  incidents.length = 0;
}
