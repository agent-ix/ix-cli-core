import type { ZodIssue } from "zod";

/**
 * Raised when a value fails the plugin's schema (write-time or env-var coercion).
 * Carries enough information to satisfy NFR-005-AC-1: plugin id, key path,
 * expected type, and file location.
 */
export class ConfigSchemaError extends Error {
  readonly pluginId: string;
  readonly filePath: string;
  readonly issues: ConfigIssue[];
  constructor(pluginId: string, filePath: string, issues: ConfigIssue[]) {
    super(formatIssues(pluginId, filePath, issues));
    this.name = "ConfigSchemaError";
    this.pluginId = pluginId;
    this.filePath = filePath;
    this.issues = issues;
  }
}

/** Raised when a plugin's config file fails to parse as YAML. */
export class ConfigParseError extends Error {
  readonly pluginId: string;
  readonly filePath: string;
  constructor(pluginId: string, filePath: string, cause: unknown) {
    super(
      `failed to parse ${filePath} for plugin ${pluginId}: ${(cause as Error)?.message ?? String(cause)}`,
    );
    this.name = "ConfigParseError";
    this.pluginId = pluginId;
    this.filePath = filePath;
    this.cause = cause;
  }
}

export interface ConfigIssue {
  keyPath: string; // dot-notated, e.g. "cluster.defaultTags"
  expected: string; // human-readable expected type
  message: string; // Zod's underlying message
  receivedValue?: string; // safely-rendered observed value (or "<redacted>")
}

/**
 * Translate Zod issues into our four-tuple `ConfigIssue` shape.
 *
 * `redactedKeys` is a set of dot-notated key paths whose observed value
 * MUST be replaced with `<redacted>` (per NFR-005-AC-2 — declared secrets).
 */
export function issuesFromZod(
  issues: ZodIssue[],
  redactedKeys: Set<string> = new Set(),
): ConfigIssue[] {
  return issues.map((issue) => {
    const keyPath = issue.path.map(String).join(".");
    const expected = describeExpected(issue);
    const receivedValue = redactedKeys.has(keyPath)
      ? "<redacted>"
      : safeRender((issue as unknown as { received?: unknown }).received);
    return {
      keyPath,
      expected,
      message: issue.message,
      receivedValue,
    };
  });
}

function describeExpected(issue: ZodIssue): string {
  // Zod 4 issue shapes vary; pull the most useful field with safe fallbacks.
  const x = issue as unknown as {
    expected?: string;
    code?: string;
    options?: unknown[];
  };
  if (typeof x.expected === "string") return x.expected;
  if (Array.isArray(x.options)) return `enum: ${x.options.join("|")}`;
  if (x.code) return x.code;
  return "valid value";
}

function safeRender(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  }
  if (
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "bigint"
  ) {
    return String(v);
  }
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
  } catch {
    return "<unrenderable>";
  }
}

function formatIssues(
  pluginId: string,
  filePath: string,
  issues: ConfigIssue[],
): string {
  const head = `config error in plugin '${pluginId}' (${filePath}):`;
  const body = issues
    .map(
      (i) =>
        `  - ${i.keyPath || "<root>"}: expected ${i.expected}, got ${i.receivedValue ?? "?"} (${i.message})`,
    )
    .join("\n");
  return `${head}\n${body}`;
}
