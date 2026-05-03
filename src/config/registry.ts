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

const plugins = new Map<string, RegisteredPlugin>();
const incidents: ConfigIncident[] = [];

export function registerPlugin(plugin: RegisteredPlugin): void {
  // Last writer wins — forPlugin() may be called multiple times for the same
  // id with the same schema; that's fine and intentional. Conflicting
  // schemas across calls is a programming error and is left to the caller.
  plugins.set(plugin.pluginId, plugin);
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
