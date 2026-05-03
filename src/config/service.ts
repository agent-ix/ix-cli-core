import { mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ZodObject, ZodRawShape } from "zod";

import { atomicWrite } from "../atomic/write.js";
import { configPathFor } from "./paths.js";
import {
  ConfigParseError,
  ConfigSchemaError,
  issuesFromZod,
} from "./errors.js";

const FILE_HEADER = "# Managed by ix — `ix config edit` to modify safely.\n";

/**
 * Public accessor returned by `ConfigService.forPlugin(...)`.
 *
 * Each instance is bound to one plugin id and reads/writes only that
 * plugin's file. Cross-plugin reads are NOT exposed by this object —
 * obtain a separate `PluginConfig` for another id (subject to the
 * static-check contract in spec.md §10.1).
 */
export interface PluginConfig<T> {
  /** Resolve effective values from file → schema defaults. Throws on schema mismatch. */
  get(): T;
  /** Merge `partial`, validate against schema, atomically rewrite the file. */
  set(partial: Partial<T>): void;
  /** Delete the plugin's file. Subsequent `get()` returns schema defaults. */
  reset(): void;
  /** Absolute path of the plugin's config file (for `ix config edit`). */
  filePath(): string;
}

export class ConfigService {
  /**
   * Return a typed accessor scoped to `pluginId`. The accessor's reads and
   * writes are bound to `~/.config/ix/config.yaml` (id `core`) or
   * `~/.config/ix/config.d/<id>.yaml` (any other id).
   */
  static forPlugin<S extends ZodRawShape>(
    pluginId: string,
    schema: ZodObject<S>,
  ): PluginConfig<ReturnType<ZodObject<S>["parse"]>> {
    return new PluginConfigImpl(pluginId, schema);
  }
}

class PluginConfigImpl<S extends ZodRawShape> implements PluginConfig<unknown> {
  private readonly pluginId: string;
  private readonly schema: ZodObject<S>;
  private readonly path: string;

  constructor(pluginId: string, schema: ZodObject<S>) {
    this.pluginId = pluginId;
    this.schema = schema;
    this.path = configPathFor(pluginId);
  }

  filePath(): string {
    return this.path;
  }

  get(): ReturnType<ZodObject<S>["parse"]> {
    const raw = this.readFileOrEmpty();
    return this.parseAndValidate(raw);
  }

  set(partial: Partial<ReturnType<ZodObject<S>["parse"]>>): void {
    const current = this.readFileOrEmpty();
    const merged = mergeDeep(current, partial as Record<string, unknown>);
    const validated = this.parseAndValidate(merged);
    this.writeYaml(validated as Record<string, unknown>);
  }

  reset(): void {
    try {
      unlinkSync(this.path);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "ENOENT") throw err;
    }
  }

  private readFileOrEmpty(): Record<string, unknown> {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") return {};
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (cause) {
      throw new ConfigParseError(this.pluginId, this.path, cause);
    }
    if (parsed == null) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ConfigParseError(
        this.pluginId,
        this.path,
        new Error("top-level value is not an object"),
      );
    }
    return parsed as Record<string, unknown>;
  }

  private parseAndValidate(
    raw: Record<string, unknown>,
  ): ReturnType<ZodObject<S>["parse"]> {
    const result = this.schema.safeParse(raw);
    if (!result.success) {
      throw new ConfigSchemaError(
        this.pluginId,
        this.path,
        issuesFromZod(result.error.issues),
      );
    }
    return result.data;
  }

  private writeYaml(value: Record<string, unknown>): void {
    ensureParent(this.path);
    const body = stringifyYaml(value, {
      lineWidth: 0,
      defaultStringType: "PLAIN",
    });
    atomicWrite(this.path, FILE_HEADER + body);
  }
}

/** Recursively merge `patch` into `base` (in-place), arrays replaced wholesale. */
function mergeDeep(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      !(v instanceof Date)
    ) {
      const baseV = out[k];
      if (baseV && typeof baseV === "object" && !Array.isArray(baseV)) {
        out[k] = mergeDeep(
          baseV as Record<string, unknown>,
          v as Record<string, unknown>,
        );
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

function ensureParent(path: string): void {
  const parent = dirname(path);
  try {
    const st = statSync(parent);
    if (!st.isDirectory()) {
      throw new Error(`expected directory at ${parent}`);
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      return;
    }
    throw err;
  }
}
