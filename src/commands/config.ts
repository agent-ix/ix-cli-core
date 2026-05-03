import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { startListing } from "@agent-ix/ix-ui-cli";
import { parse as parseYaml } from "yaml";

import { CORE_PLUGIN_ID } from "../config/paths.js";
import { doctor } from "../config/doctor.js";
import {
  ConfigParseError,
  ConfigSchemaError,
  type ConfigIssue,
  issuesFromZod,
} from "../config/errors.js";
import { ConfigService } from "../config/service.js";
import {
  getRegisteredPlugin,
  listRegisteredPlugins,
  type RegisteredPlugin,
} from "../config/registry.js";
import { listSecretsForPlugin } from "../secrets/registry.js";

const DEFAULT_PLUGIN_ID = CORE_PLUGIN_ID;

/** Raised when a non-existent plugin id is named on the command line. */
export class UnknownPluginError extends Error {
  readonly pluginId: string;
  readonly registered: string[];
  constructor(pluginId: string, registered: string[]) {
    super(
      `unknown plugin id ${JSON.stringify(pluginId)} — registered ids: ${
        registered.length === 0 ? "<none>" : registered.join(", ")
      }`,
    );
    this.name = "UnknownPluginError";
    this.pluginId = pluginId;
    this.registered = registered;
  }
}

/** Raised when a non-scalar value is supplied without valid JSON. */
export class ConfigSetParseError extends Error {
  readonly keyPath: string;
  readonly expected: string;
  constructor(keyPath: string, expected: string, cause?: Error) {
    super(
      `failed to parse value for ${keyPath}: expected ${expected} as JSON${cause ? ` (${cause.message})` : ""}. Wrap non-scalar values in single quotes, e.g. '["a","b"]'.`,
    );
    this.name = "ConfigSetParseError";
    this.keyPath = keyPath;
    this.expected = expected;
    this.cause = cause;
  }
}

function redactedKeyPaths(pluginId: string): Set<string> {
  const out = new Set<string>();
  for (const s of listSecretsForPlugin(pluginId)) out.add(s.name);
  return out;
}

function resolvePlugin(pluginId: string | undefined): RegisteredPlugin {
  const id = pluginId ?? DEFAULT_PLUGIN_ID;
  const plugin = getRegisteredPlugin(id);
  if (!plugin) {
    throw new UnknownPluginError(
      id,
      listRegisteredPlugins()
        .map((p) => p.pluginId)
        .sort(),
    );
  }
  return plugin;
}

function getByPath(obj: unknown, segments: string[]): unknown {
  let cursor: unknown = obj;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

function setByPath(
  obj: Record<string, unknown>,
  segments: string[],
  value: unknown,
): void {
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i];
    const next = cursor[k];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[k] = {};
    }
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

/**
 * Inspect the plugin's Zod schema and the dotted key path. Returns:
 * - `{ kind: "scalar" }` if the leaf is a string/number/boolean/enum.
 * - `{ kind: "complex", expected }` if the leaf is an array or object.
 * - `{ kind: "unknown" }` if the path doesn't resolve in the schema (best-
 *   effort inference; we let Zod do the final say at validation time).
 *
 * The result drives FR-018 value parsing — scalars pass through to schema
 * coercion, non-scalars must be valid JSON.
 */
function classifyKey(
  plugin: RegisteredPlugin,
  segments: string[],
): { kind: "scalar" | "complex"; expected: string } | { kind: "unknown" } {
  // Walk into the schema's `.shape` recursively. Zod 4 exposes the inner
  // type via `_def.innerType` for ZodOptional/ZodDefault wrappers.
  let node: unknown = plugin.schema;
  for (const seg of segments) {
    const shape = unwrapShape(node);
    if (!shape || !(seg in shape)) return { kind: "unknown" };
    node = shape[seg];
  }
  const inner = unwrapToBaseDef(node);
  if (!inner) return { kind: "unknown" };
  const typeName = inner.typeName ?? inner.type ?? "?";
  if (
    typeName === "ZodString" ||
    typeName === "string" ||
    typeName === "ZodNumber" ||
    typeName === "number" ||
    typeName === "ZodBoolean" ||
    typeName === "boolean" ||
    typeName === "ZodEnum" ||
    typeName === "enum" ||
    typeName === "ZodLiteral" ||
    typeName === "literal"
  ) {
    return { kind: "scalar", expected: typeName };
  }
  if (
    typeName === "ZodArray" ||
    typeName === "array" ||
    typeName === "ZodObject" ||
    typeName === "object" ||
    typeName === "ZodRecord" ||
    typeName === "record" ||
    typeName === "ZodTuple" ||
    typeName === "tuple"
  ) {
    return { kind: "complex", expected: typeName };
  }
  return { kind: "scalar", expected: typeName };
}

function unwrapShape(node: unknown): Record<string, unknown> | undefined {
  const inner = unwrapToBaseDef(node);
  if (!inner) return undefined;
  // ZodObject's shape may be on `inner.shape` (Zod 3) or `inner.shape()` (some versions).
  const shape = (inner as { shape?: unknown }).shape;
  if (typeof shape === "function")
    return (shape as () => Record<string, unknown>)();
  if (shape && typeof shape === "object")
    return shape as Record<string, unknown>;
  return undefined;
}

function unwrapToBaseDef(
  node: unknown,
): { typeName?: string; type?: string; shape?: unknown } | undefined {
  let cursor = node as
    | {
        _def?: { innerType?: unknown; typeName?: string; type?: string };
        def?: { type?: string; innerType?: unknown };
        _zod?: { def?: { type?: string; innerType?: unknown } };
      }
    | undefined;
  for (let i = 0; i < 16 && cursor; i++) {
    // Zod 3: cursor._def.typeName
    // Zod 4 v3 shim: cursor.def.type (snake_case names)
    const def =
      (cursor as { _def?: { innerType?: unknown; typeName?: string } })._def ??
      (cursor as { def?: { innerType?: unknown; type?: string } }).def ??
      (cursor as { _zod?: { def?: { innerType?: unknown; type?: string } } })
        ._zod?.def;
    if (!def) break;
    const inner = (def as { innerType?: unknown }).innerType;
    if (inner) {
      cursor = inner as typeof cursor;
      continue;
    }
    return {
      typeName: (def as { typeName?: string }).typeName,
      type: (def as { type?: string }).type,
      shape: (cursor as { shape?: unknown }).shape,
    };
  }
  return undefined;
}

/** Format a value for `ix config get` rendering. */
function formatValue(v: unknown): string {
  if (v === undefined) return "<unset>";
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  return JSON.stringify(v);
}

/* ── runConfigGet ────────────────────────────────────────────────────── */

export async function runConfigGet(
  pluginId: string | undefined,
  keyPath: string,
): Promise<void> {
  const plugin = resolvePlugin(pluginId);
  const cfg = ConfigService.forPlugin(plugin.pluginId, plugin.schema, {
    envBindings: plugin.envBindings,
  });
  const segments = keyPath.split(".");
  const value = getByPath(cfg.get(), segments);

  const list = startListing("ix config get");
  if (value === undefined) {
    list.warn(
      `${plugin.pluginId}.${keyPath} is unset (file: ${cfg.filePath()})`,
    );
    return;
  }
  list.item(`${plugin.pluginId}.${keyPath}`, formatValue(value));
  list.success("ok");
}

/* ── runConfigSet ────────────────────────────────────────────────────── */

export async function runConfigSet(
  pluginId: string | undefined,
  keyPath: string,
  rawValue: string,
): Promise<void> {
  const plugin = resolvePlugin(pluginId);
  const segments = keyPath.split(".");
  const classification = classifyKey(plugin, segments);

  let parsed: unknown;
  if (classification.kind === "complex") {
    try {
      parsed = JSON.parse(rawValue);
    } catch (err) {
      throw new ConfigSetParseError(
        keyPath,
        classification.expected,
        err as Error,
      );
    }
  } else {
    // Scalar (or unknown — let Zod be the judge). Pass the raw string and
    // let `z.coerce.*` / strict enums do the conversion.
    parsed = rawValue;
  }

  const cfg = ConfigService.forPlugin(plugin.pluginId, plugin.schema, {
    envBindings: plugin.envBindings,
  });
  const current = cfg.get();
  const next: Record<string, unknown> = JSON.parse(JSON.stringify(current));
  setByPath(next, segments, parsed);

  // Validate the FULL merged object so unknown sibling keys still trip strict mode.
  const result = plugin.schema.safeParse(next);
  if (!result.success) {
    throw new ConfigSchemaError(
      plugin.pluginId,
      cfg.filePath(),
      issuesFromZod(result.error.issues, redactedKeyPaths(plugin.pluginId)),
    );
  }

  cfg.set(result.data as Partial<Record<string, unknown>>);

  const list = startListing("ix config set");
  list.item(`${plugin.pluginId}.${keyPath}`, formatValue(parsed));
  list.success(`stored in ${cfg.filePath()}`);
}

/* ── runConfigDoctor ─────────────────────────────────────────────────── */

export async function runConfigDoctor(): Promise<{ exitCode: number }> {
  const list = startListing("ix config doctor");
  const report = doctor();

  let invalidCount = 0;
  for (const entry of report.entries) {
    if (entry.kind === "valid") {
      list.item(
        entry.pluginId,
        `valid (${entry.keyCount} keys, ${entry.filePath})`,
      );
    } else if (entry.kind === "invalid") {
      invalidCount += 1;
      list.item(entry.pluginId, `invalid (${entry.filePath})`);
      for (const e of entry.errors) {
        list.note(formatIssueLine(entry.pluginId, entry.filePath, e));
      }
    } else {
      list.item(entry.pluginId, `unregistered file (${entry.filePath})`);
    }
  }

  if (report.recentIncidents.length > 0) {
    list.note("recent incidents:");
    for (const inc of report.recentIncidents) {
      list.note(`  ${inc.pluginId} (${inc.kind}): ${inc.detail}`);
    }
  }

  if (invalidCount === 0) {
    list.success("all registered plugins valid");
    return { exitCode: 0 };
  }
  list.error(`${invalidCount} plugin(s) failed validation`);
  return { exitCode: 1 };
}

function formatIssueLine(
  pluginId: string,
  filePath: string,
  issue: ConfigIssue,
): string {
  return `${pluginId}.${issue.keyPath || "<root>"}: expected ${issue.expected}, got ${issue.receivedValue ?? "?"} — ${issue.message} (${filePath})`;
}

/* ── runConfigEdit ───────────────────────────────────────────────────── */

export async function runConfigEdit(
  pluginId: string | undefined,
): Promise<void> {
  const plugin = resolvePlugin(pluginId);
  const cfg = ConfigService.forPlugin(plugin.pluginId, plugin.schema, {
    envBindings: plugin.envBindings,
  });
  // Trigger a write so the file exists for $EDITOR to open. If the file
  // is already valid, `set({})` is a no-op merge that just rewrites the
  // current content atomically.
  cfg.set({} as Partial<Record<string, unknown>>);

  const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vi";
  const filePath = cfg.filePath();

  const list = startListing("ix config edit");
  list.note(`opening ${filePath} in ${editor}`);
  list.commit();

  // Run editor synchronously; let it inherit stdio. Failure of the editor
  // is reported but the file (atomic) is unaffected.
  try {
    execSync(`${editor} ${shellQuote(filePath)}`, { stdio: "inherit" });
  } catch (err) {
    list.error(`editor exited non-zero: ${(err as Error).message}`);
    throw err;
  }

  // Validate post-edit. We re-read the file directly so a YAML parse
  // error or unknown key surfaces as a hard error here (not via the
  // soft-default path in cfg.get(), which deliberately swallows for
  // FR-011-AC-1). Re-edit loop is left to the oclif wrapper, where
  // prompts naturally live.
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = parseYaml(raw);
    if (
      parsed != null &&
      (typeof parsed !== "object" || Array.isArray(parsed))
    ) {
      throw new ConfigParseError(
        plugin.pluginId,
        filePath,
        new Error("top-level YAML value is not an object"),
      );
    }
    const result = plugin.schema.safeParse(parsed ?? {});
    if (!result.success) {
      throw new ConfigSchemaError(
        plugin.pluginId,
        filePath,
        issuesFromZod(result.error.issues, redactedKeyPaths(plugin.pluginId)),
      );
    }
  } catch (err) {
    if (err instanceof ConfigSchemaError || err instanceof ConfigParseError) {
      list.error(`post-edit validation failed: ${err.message}`);
    }
    throw err;
  }
  list.success("validated");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
