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
import { withFileLock } from "./lock.js";
import {
  clearIncidentsForPlugin,
  recordIncident,
  registerPlugin,
  type RegisterResult,
} from "./registry.js";
import { listSecretsForPlugin } from "../secrets/registry.js";

const FILE_HEADER = "# Managed by ix — `ix config edit` to modify safely.\n";

export interface ForPluginOptions {
  /**
   * Map of dot-notated key paths → environment variable names. When the env
   * var is set at `get()` time, its string value layers over the file value
   * (per FR-012 layered resolution). Schema is responsible for coercing the
   * string to the target type — use `z.coerce.*` for non-string fields.
   */
  envBindings?: Record<string, string>;
}

/**
 * Public accessor returned by `ConfigService.forPlugin(...)`.
 *
 * Each instance is bound to one plugin id and reads/writes only that
 * plugin's file. Cross-plugin reads are NOT exposed by this object —
 * obtain a separate `PluginConfig` for another id (subject to the
 * static-check contract in spec.md §10.1).
 */
export interface PluginConfig<T> {
  /**
   * Resolve effective values from env → file → schema defaults.
   *
   * Per FR-011-AC-1, parse and validation errors are NOT thrown to the
   * caller; instead, schema defaults are returned and the error is recorded
   * in the incident registry (visible via `ConfigService.doctor()`). This
   * lets one bad plugin file never crash an unrelated plugin's command.
   */
  get(): T;
  /**
   * Merge `partial` over the current file content, validate against the
   * plugin's strict schema, and atomically rewrite the file. Per FR-010-AC-4
   * unknown keys throw `ConfigSchemaError`. Per FR-011-AC-4 same-plugin
   * concurrent writes are serialized via an advisory lockfile.
   */
  set(partial: Partial<T>): void;
  /**
   * Validate `value` against the plugin's schema and atomically rewrite the
   * file with it — without merging into the existing on-disk content. Use
   * this when a write must REMOVE keys (e.g. deleting a map entry); `set`'s
   * deep-merge semantics treat absent keys as "no change" and cannot
   * express deletions. Same locking + incident clearing as `set`.
   */
  replace(value: T): void;
  /** Delete the plugin's file. Subsequent `get()` returns schema defaults. */
  reset(): void;
  /** Absolute path of the plugin's config file (for `ix config edit`). */
  filePath(): string;
}

export class ConfigService {
  /**
   * Return a typed accessor scoped to `pluginId`. The accessor's reads and
   * writes are bound to `~/.config/ix/config.yaml` (id `core`) or
   * `~/.config/ix/config.d/<id>.yaml` (any other id). The plugin is
   * auto-registered for `doctor()`.
   */
  static forPlugin<S extends ZodRawShape>(
    pluginId: string,
    schema: ZodObject<S>,
    opts: ForPluginOptions = {},
  ): PluginConfig<ReturnType<ZodObject<S>["parse"]>> {
    const result: RegisterResult = registerPlugin({
      pluginId,
      schema: schema as unknown as ZodObject<ZodRawShape>,
      envBindings: opts.envBindings,
    });
    if (!result.ok && result.kind === "duplicate-id") {
      // FR-013-AC-3 first-wins: record the conflict so `ix config doctor`
      // surfaces it. The accessor returned still binds to the supplied
      // schema for the caller's use; only the global registry preserves
      // the first registration. The init hook (slice 10) is the
      // authoritative caller; tests using `_resetRegistryForTests` won't
      // hit this branch.
      recordIncident({
        pluginId,
        filePath: configPathFor(pluginId),
        kind: "schema",
        detail: `duplicate-id registration rejected — first registration preserved`,
      });
    }
    return new PluginConfigImpl(pluginId, schema, opts);
  }
}

class PluginConfigImpl<S extends ZodRawShape> implements PluginConfig<unknown> {
  private readonly pluginId: string;
  private readonly schema: ZodObject<S>;
  private readonly path: string;
  private readonly envBindings?: Record<string, string>;

  constructor(pluginId: string, schema: ZodObject<S>, opts: ForPluginOptions) {
    this.pluginId = pluginId;
    this.schema = schema;
    this.path = configPathFor(pluginId);
    this.envBindings = opts.envBindings;
  }

  filePath(): string {
    return this.path;
  }

  /**
   * Set of dot-notated key paths that MUST be rendered as `<redacted>` in
   * any user-facing error message (NFR-005-AC-2). For v1 we redact every
   * key path that matches a registered secret name for this plugin —
   * config schemas SHOULD NOT carry secret values, but if a typo or
   * misconfiguration ever lands one there, the error rendering won't leak.
   */
  private redactedKeyPaths(): Set<string> {
    const out = new Set<string>();
    for (const s of listSecretsForPlugin(this.pluginId)) {
      out.add(s.name);
    }
    return out;
  }

  get(): ReturnType<ZodObject<S>["parse"]> {
    let fileLayer: Record<string, unknown>;
    try {
      fileLayer = this.readFileOrEmpty();
    } catch (err) {
      // FR-011-AC-1: parse errors do not propagate; fall back to defaults.
      recordIncident({
        pluginId: this.pluginId,
        filePath: this.path,
        kind: err instanceof ConfigParseError ? "parse" : "io",
        detail: (err as Error).message,
      });
      fileLayer = {};
    }
    const layered = this.applyEnvLayer(fileLayer);
    const result = this.schema.safeParse(layered);
    if (!result.success) {
      // FR-011-AC-1: schema-validation errors do not propagate; fall back
      // to defaults parsed from `{}` (which the schema's defaults populate).
      recordIncident({
        pluginId: this.pluginId,
        filePath: this.path,
        kind: "schema",
        detail: `schema validation failed (${result.error.issues.length} issue(s))`,
        issues: issuesFromZod(result.error.issues, this.redactedKeyPaths()),
      });
      // FR-011-AC-1: return schema defaults rather than throw. If the
      // schema doesn't have defaults for every key (e.g. a required
      // field), `parse({})` would itself throw — fall through to a
      // best-effort empty object cast so the caller's command never
      // crashes on a corrupt file.
      const fallback = this.schema.safeParse({});
      if (fallback.success) return fallback.data;
      return {} as ReturnType<ZodObject<S>["parse"]>;
    }
    return result.data;
  }

  set(partial: Partial<ReturnType<ZodObject<S>["parse"]>>): void {
    ensureParent(this.path);
    withFileLock(`${this.path}.lock`, () => {
      // FR-011-AC-2: a malformed existing file must not block recovery.
      // Treat parse errors as an empty base; the new write will replace
      // the corrupt content atomically.
      let current: Record<string, unknown>;
      try {
        current = this.readFileOrEmpty();
      } catch {
        current = {};
      }
      const merged = mergeDeep(current, partial as Record<string, unknown>);
      const result = this.schema.safeParse(merged);
      if (!result.success) {
        throw new ConfigSchemaError(
          this.pluginId,
          this.path,
          issuesFromZod(result.error.issues, this.redactedKeyPaths()),
        );
      }
      this.writeYaml(result.data as Record<string, unknown>);
      // A successful set clears any prior incidents for this plugin —
      // the file is now valid by definition.
      clearIncidentsForPlugin(this.pluginId);
    });
  }

  replace(value: ReturnType<ZodObject<S>["parse"]>): void {
    ensureParent(this.path);
    withFileLock(`${this.path}.lock`, () => {
      const result = this.schema.safeParse(value);
      if (!result.success) {
        throw new ConfigSchemaError(
          this.pluginId,
          this.path,
          issuesFromZod(result.error.issues, this.redactedKeyPaths()),
        );
      }
      this.writeYaml(result.data as Record<string, unknown>);
      clearIncidentsForPlugin(this.pluginId);
    });
  }

  reset(): void {
    try {
      unlinkSync(this.path);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "ENOENT") throw err;
    }
    clearIncidentsForPlugin(this.pluginId);
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

  private applyEnvLayer(
    base: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!this.envBindings) return base;
    const out = cloneDeep(base);
    for (const [keyPath, envVar] of Object.entries(this.envBindings)) {
      const value = process.env[envVar];
      if (value === undefined) continue;
      setDeep(out, keyPath.split("."), value);
    }
    return out;
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

/** Recursively merge `patch` into `base`, arrays replaced wholesale. */
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

function cloneDeep<T>(v: T): T {
  if (v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((e) => cloneDeep(e)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = cloneDeep(val);
  }
  return out as unknown as T;
}

function setDeep(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cursor = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = cursor[key];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cursor[key] = fresh;
      cursor = fresh;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[path[path.length - 1]] = value;
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
