import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { configDRoot, configPathFor, CORE_PLUGIN_ID } from "./paths.js";
import { ConfigIssue, ConfigSchemaError, issuesFromZod } from "./errors.js";
import {
  ConfigIncident,
  getRegisteredPlugin,
  listIncidents,
  listRegisteredPlugins,
} from "./registry.js";

export type DoctorEntry =
  | {
      kind: "valid";
      pluginId: string;
      filePath: string;
      keyCount: number;
    }
  | {
      kind: "invalid";
      pluginId: string;
      filePath: string;
      errors: ConfigIssue[];
    }
  | {
      kind: "unregistered";
      pluginId: string;
      filePath: string;
    };

export interface DoctorReport {
  entries: DoctorEntry[];
  recentIncidents: ConfigIncident[];
}

/**
 * Validate every config file on disk against its registered plugin schema
 * and return a structured report. Implements FR-011-AC-3 (doctor returns
 * scoped errors per failing file, never throws) and FR-018-AC-5 (mixed
 * valid/invalid reporting).
 *
 * Output is sorted by `(pluginId)` ascending so it's byte-stable across
 * runs given identical inputs (NFR-005-AC-3).
 */
export function doctor(): DoctorReport {
  const entries: DoctorEntry[] = [];

  // 1. Walk every registered plugin and check whether its file is valid.
  for (const plugin of listRegisteredPlugins()) {
    const filePath = configPathFor(plugin.pluginId);
    const result = checkFile(
      plugin.pluginId,
      filePath,
      plugin.schema.safeParse.bind(plugin.schema),
    );
    entries.push(result);
  }

  // 2. Walk config.d/ for files belonging to plugins we don't know about.
  for (const found of listConfigDFiles()) {
    if (entries.some((e) => e.pluginId === found.pluginId)) continue;
    if (getRegisteredPlugin(found.pluginId)) continue;
    entries.push({
      kind: "unregistered",
      pluginId: found.pluginId,
      filePath: found.path,
    });
  }

  // 3. The core file may exist without a registered schema (e.g. a partial
  // install); flag it as unregistered too.
  const corePath = configPathFor(CORE_PLUGIN_ID);
  if (
    !entries.some((e) => e.pluginId === CORE_PLUGIN_ID) &&
    fileExists(corePath)
  ) {
    entries.push({
      kind: "unregistered",
      pluginId: CORE_PLUGIN_ID,
      filePath: corePath,
    });
  }

  entries.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  return {
    entries,
    recentIncidents: listIncidents().sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.observedAt - b.observedAt,
    ),
  };
}

function checkFile(
  pluginId: string,
  filePath: string,
  safeParse: (raw: unknown) => {
    success: boolean;
    error?: { issues: Parameters<typeof issuesFromZod>[0] };
    data?: unknown;
  },
): DoctorEntry {
  if (!fileExists(filePath)) {
    // No file → schema defaults apply. That's a valid state.
    const r = safeParse({});
    if (r.success) {
      return {
        kind: "valid",
        pluginId,
        filePath,
        keyCount: r.data
          ? Object.keys(r.data as Record<string, unknown>).length
          : 0,
      };
    }
    return {
      kind: "invalid",
      pluginId,
      filePath,
      errors: r.error ? issuesFromZod(r.error.issues) : [],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      kind: "invalid",
      pluginId,
      filePath,
      errors: [
        {
          keyPath: "",
          expected: "readable file",
          message: (err as Error).message,
          receivedValue: "<io-error>",
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    return {
      kind: "invalid",
      pluginId,
      filePath,
      errors: [
        {
          keyPath: "",
          expected: "valid YAML object",
          message: (err as Error).message,
          receivedValue: "<parse-error>",
        },
      ],
    };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "invalid",
      pluginId,
      filePath,
      errors: [
        {
          keyPath: "",
          expected: "object",
          message: "top-level YAML value is not an object",
          receivedValue:
            parsed === null
              ? "null"
              : Array.isArray(parsed)
                ? "array"
                : typeof parsed,
        },
      ],
    };
  }

  const r = safeParse(parsed);
  if (r.success) {
    return {
      kind: "valid",
      pluginId,
      filePath,
      keyCount: Object.keys(parsed as Record<string, unknown>).length,
    };
  }
  return {
    kind: "invalid",
    pluginId,
    filePath,
    errors: r.error ? issuesFromZod(r.error.issues) : [],
  };
}

function listConfigDFiles(): Array<{ pluginId: string; path: string }> {
  const dir = configDRoot();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Array<{ pluginId: string; path: string }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".yaml")) continue;
    const id = entry.slice(0, -5);
    out.push({ pluginId: id, path: join(dir, entry) });
  }
  return out;
}

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// Re-export so consumers don't have to dig into errors.ts to type-narrow.
export type { ConfigSchemaError };
