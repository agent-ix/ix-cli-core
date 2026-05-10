import { z } from "zod";

import { isValidPluginId } from "../config/paths.js";
import {
  registerIxPlugin,
  type IxPluginRegistrationResult,
} from "../plugins/registry.js";
import type { IxPlugin } from "../plugins/types.js";

export const PluginManifestEntrySchema = z
  .object({
    package: z.string().min(1),
    enabled: z.boolean().default(true),
    version: z.string().min(1).optional(),
    optional: z.boolean().default(true),
  })
  .strict();

export const PluginManifestSchema = z
  .object({
    plugins: z.record(z.string(), PluginManifestEntrySchema).default({}),
  })
  .strict();

export type PluginManifestEntry = z.infer<typeof PluginManifestEntrySchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface PluginManifestLayer {
  name: "distribution" | "user" | "project" | string;
  manifest: PluginManifest;
}

export interface ResolvedPluginManifestEntry extends PluginManifestEntry {
  id: string;
  source: string;
}

export interface PluginManifestDiagnostic {
  kind: "invalid-plugin-id" | "load-failed" | "invalid-module";
  pluginId: string;
  source: string;
  detail: string;
}

export interface PluginLoadResult {
  plugins: ResolvedPluginManifestEntry[];
  loaded: Array<{
    entry: ResolvedPluginManifestEntry;
    plugin: IxPlugin;
    registration: IxPluginRegistrationResult;
  }>;
  diagnostics: PluginManifestDiagnostic[];
}

export type PluginModuleResolver = (
  specifier: string,
  entry: ResolvedPluginManifestEntry,
) => Promise<unknown> | unknown;

export function parsePluginManifest(value: unknown): PluginManifest {
  return PluginManifestSchema.parse(value);
}

export function resolvePluginManifestLayers(
  layers: readonly PluginManifestLayer[],
): {
  plugins: ResolvedPluginManifestEntry[];
  diagnostics: PluginManifestDiagnostic[];
} {
  const enabled = new Map<string, ResolvedPluginManifestEntry>();
  const diagnostics: PluginManifestDiagnostic[] = [];

  for (const layer of layers) {
    for (const [pluginId, entry] of Object.entries(layer.manifest.plugins)) {
      if (!isValidPluginId(pluginId)) {
        diagnostics.push({
          kind: "invalid-plugin-id",
          pluginId,
          source: layer.name,
          detail: `invalid plugin id ${JSON.stringify(pluginId)}`,
        });
        continue;
      }
      if (!entry.enabled) {
        enabled.delete(pluginId);
        continue;
      }
      enabled.set(pluginId, {
        id: pluginId,
        source: layer.name,
        ...entry,
      });
    }
  }

  return { plugins: Array.from(enabled.values()), diagnostics };
}

export async function loadPluginManifestLayers(input: {
  layers: readonly PluginManifestLayer[];
  resolveModule: PluginModuleResolver;
}): Promise<PluginLoadResult> {
  const resolved = resolvePluginManifestLayers(input.layers);
  const loaded: PluginLoadResult["loaded"] = [];
  const diagnostics = [...resolved.diagnostics];

  for (const entry of resolved.plugins) {
    try {
      const mod = await input.resolveModule(entry.package, entry);
      const plugin = ixPluginFromModule(mod, entry.id);
      if (!plugin) {
        diagnostics.push({
          kind: "invalid-module",
          pluginId: entry.id,
          source: entry.source,
          detail: `module ${entry.package} did not export an IxPlugin descriptor`,
        });
        continue;
      }
      loaded.push({
        entry,
        plugin,
        registration: registerIxPlugin(plugin),
      });
    } catch (err) {
      diagnostics.push({
        kind: "load-failed",
        pluginId: entry.id,
        source: entry.source,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { plugins: resolved.plugins, loaded, diagnostics };
}

function ixPluginFromModule(
  mod: unknown,
  pluginId: string,
): IxPlugin | undefined {
  const candidates = [
    mod,
    (mod as { default?: unknown })?.default,
    (mod as { ixPlugin?: unknown })?.ixPlugin,
    (mod as Record<string, unknown> | undefined)?.[`${pluginId}IxPlugin`],
  ];
  return candidates.find(isIxPluginLike) as IxPlugin | undefined;
}

function isIxPluginLike(value: unknown): value is IxPlugin {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}
