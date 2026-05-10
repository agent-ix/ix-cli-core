import { homedir } from "node:os";
import { join } from "node:path";

import { getRuntimeContext } from "../runtime/context.js";

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/;

/** Reserved plugin id owned by `apps/ix` itself. Lives at `~/.config/ix/config.yaml`. */
export const CORE_PLUGIN_ID = "core";

/**
 * Resolve the absolute config path for a plugin id.
 *
 * - `core` → `$XDG_CONFIG_HOME/ix/config.yaml` (FR-010 file-layout carve-out).
 * - any other id → `$XDG_CONFIG_HOME/ix/config.d/<id>.yaml`.
 *
 * Honors `XDG_CONFIG_HOME`, falls back to `~/.config`.
 */
export function configPathFor(pluginId: string): string {
  return configPathForRoot(configRoot(), pluginId);
}

export function configPathForRoot(root: string, pluginId: string): string {
  validatePluginIdOrThrow(pluginId);
  if (pluginId === CORE_PLUGIN_ID) return join(root, "config.yaml");
  return join(root, "config.d", `${pluginId}.yaml`);
}

/** Absolute path to `$XDG_CONFIG_HOME/ix/`. */
export function configRoot(): string {
  const runtime = getRuntimeContext();
  if (runtime.configRoot) return runtime.configRoot;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, runtime.configNamespace);
}

/** Absolute path to `$XDG_CONFIG_HOME/ix/config.d/`. */
export function configDRoot(): string {
  return join(configRoot(), "config.d");
}

/**
 * Validate a plugin id against the FR-013-AC-7 regex. Throws
 * `InvalidPluginIdError` on mismatch.
 */
export function validatePluginIdOrThrow(pluginId: string): void {
  if (!isValidPluginId(pluginId)) {
    throw new InvalidPluginIdError(pluginId);
  }
}

export function isValidPluginId(pluginId: string): boolean {
  if (typeof pluginId !== "string") return false;
  if (pluginId.length === 0 || pluginId.length > 64) return false;
  return PLUGIN_ID_RE.test(pluginId);
}

export class InvalidPluginIdError extends Error {
  readonly pluginId: string;
  constructor(pluginId: string) {
    super(
      `invalid plugin id ${JSON.stringify(pluginId)} — must match /^[a-z][a-z0-9-]*$/ and be ≤64 chars`,
    );
    this.name = "InvalidPluginIdError";
    this.pluginId = pluginId;
  }
}
