---
id: NFR-003
title: "Schema Validation Errors Are Actionable"
type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-008"
    type: "requires"
    cardinality: "1:1"
---

## Statement

Every config validation error surfaced by `ConfigService`, `config set`, `config edit`, or `config doctor` SHALL identify all four of:

1. **Plugin id** (e.g. `local`)
2. **Key path** within the schema, dot-notated (e.g. `cluster.defaultTags`)
3. **Expected type** in human-readable form (e.g. `array<string>`, `enum: debug|info|warn|error`, `string matching /^v?\d+\.\d+\.\d+$/`)
4. **File location** — absolute path of the config file (e.g. `/home/user/.config/ix/config.d/local.yaml`)

Errors SHALL also include the **observed value** (rendered safely; objects truncated at 80 chars), unless the offending key is declared as a secret in the plugin's `secrets` declaration (in which case the value is replaced with `<redacted>`).

Errors are rendered through the host CLI's UI primitives (e.g. `@agent-ix/ix-ui-cli` `list.error(...)`) and never via `console.error` directly.

**Aggregate doctor output.** `config doctor` SHALL aggregate all validation errors per plugin and render them in a stable, scriptable order (sorted by plugin id, then key path). The exit code is non-zero iff any plugin has at least one error.

**No raw Zod traces.** The user-facing message MUST NOT show raw Zod `issues[]` JSON or stack traces. Internal Zod issues SHALL be translated into the four-tuple above by a single `formatSchemaError(pluginId, filePath, issues)` helper.

## Rationale

A plugin author or operator hitting a config error needs to fix it without reading the codebase. The four-tuple is the minimum information that pinpoints a fix: which plugin, which key, what's expected, where the file lives. Hiding values for declared secrets prevents `config doctor` from leaking a token if a misconfiguration nudges one into the wrong store.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Required tuple elements (plugin id, key path, expected type, file path) present in a rendered validation error | 4 of 4 | 4 of 4 | Test (NFR-003-AC-1) |
| Declared-secret value leaked into rendered error output | 0 | 0 | Test (redaction check, NFR-003-AC-2) |
| `config doctor` output ordering stability across identical-input runs | byte-stable | byte-stable | Test (snapshot, NFR-003-AC-3) |
| `console.error` schema-error sinks / raw Zod `issues[]` renders in `src/` | 0 | 0 | Analysis (static grep, NFR-003-AC-4, NFR-003-AC-5) |

## Acceptance Criteria

- **NFR-003-AC-1**: Setting `local.cluster.defaultTags` to `42` produces an error whose rendered text contains all of: `local`, `cluster.defaultTags`, `array<string>`, and the absolute path to `config.d/local.yaml`.
- **NFR-003-AC-2**: An error rendered for a key declared as a secret SHALL contain `<redacted>` in place of the observed value; a static check confirms the actual value is not present in the rendered output.
- **NFR-003-AC-3**: `config doctor` against two failing plugins emits errors in `(pluginId, keyPath)` ascending order; output is byte-stable across runs given identical inputs.
- **NFR-003-AC-4**: A static grep across `src/` SHALL find zero invocations of `console.error` for schema errors; all paths route through the host UI primitives.
- **NFR-003-AC-5**: A static grep SHALL find zero call sites that render Zod's raw `issues[]` JSON; only `formatSchemaError` produces user-facing strings.

## Verification

- Unit tests exercise every Zod error variant the codebase emits and assert the four-tuple shape.
- A snapshot test for `config doctor` output guards stable ordering (NFR-003-AC-3).
