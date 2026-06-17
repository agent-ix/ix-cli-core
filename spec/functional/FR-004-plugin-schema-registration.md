---
id: FR-004
title: "Plugin Schema Registration"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-005"
    type: "requires"
    cardinality: "1:1"
---

## Description

A plugin's schema is declared through the `ixSchema` named export (FR-014). `@agent-ix/ix-cli-core` SHALL expose a registration surface accepting the following shape:

```typescript
interface IxPluginSchema {
  id?: string; // optional config/secrets namespace
  config?: ZodObject<ZodRawShape>; // MUST be Zod .strict()
  secrets?: SecretDeclaration[];
  env?: Record<string, string>;
}

interface SecretDeclaration {
  name: string; // local name; full id is "<pluginId>.<name>"
  description: string; // shown by `secrets list` and prompts
  required?: boolean; // when true, login flow will prompt
  envVar?: string; // optional env binding (e.g. "IX_GHCR_TOKEN")
}
```

**Registration.** The host binary's `init` hook SHALL walk every loaded plugin and:

1. If `config` is present, register it with the global `ConfigService` registry under the derived plugin id. The schema MUST be `.strict()`.
2. If `secrets` is present, register each entry with the global `SecretsService` registry as `<pluginId>.<entry.name>`.
3. Reject duplicate registrations under the same id.
4. Reject any third-party plugin using the reserved id `core`.

**Init failure isolation.** Every registration failure (non-strict schema, duplicate id, reserved-id misuse) SHALL be **logged and skipped**, NOT thrown. The offending plugin is excluded from the registry; other plugins continue to load; startup succeeds. The failure is recorded for surfacing by `config doctor` and `--version --verbose`. A `PluginRegistrationError` value type carries the failure reason but is captured by the registration loop, never propagated to the process boundary.

**Schema scoping.** A plugin's schema is in scope only when that plugin's commands or services run; it is not exposed as a global type. Cross-plugin schema introspection is deliberately not provided.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-004-AC-1 | A plugin declaring `config: z.object({ tags: z.array(z.string()) }).strict()` makes `ConfigService.forPlugin(pluginId, …)` validate writes against that schema. | Test |
| FR-004-AC-2 | A plugin declaring a non-strict `config` (`.passthrough()` or no `.strict()`) is logged and skipped — its registration is rejected, the failure is recorded for `config doctor`, and other plugins continue to load. Process exit code is unchanged. | Test |
| FR-004-AC-3 | Given two plugins with the same id, only the first registers; the second is logged and skipped. Both events are reported by `config doctor`. | Test |
| FR-004-AC-4 | A third-party plugin attempting to register under id `core` is logged and skipped; the legitimate `core` registration owned by the host binary is preserved. | Test |
| FR-004-AC-5 | For every registration failure (AC-2/3/4), `config doctor` SHALL surface the failed plugin id, the failure reason (`non-strict-schema` / `duplicate-id` / `reserved-id-core`), and the plugin's discovery source (npm package name + version). | Test |
| FR-004-AC-6 | A `secrets` entry with `envVar: "IX_FOO"` causes `SecretsService.get('<id>.foo')` to honor `IX_FOO` ahead of any persisted backend (per FR-005 resolution order). | Test |
| FR-004-AC-7 | A derived plugin id SHALL match the regex `^[a-z][a-z0-9-]*$` (lowercase ASCII, starts with a letter, letters/digits/hyphens only, length ≤ 64). The id is used as a filename component for `config.d/<id>.yaml` and `secrets.d/<id>.age`; this constraint prevents path-traversal characters (`/`, `..`, `\`), shell-special characters, and empty ids from ever reaching the filesystem. A registration whose id violates the regex is logged and skipped (per AC-2/3/4 init-failure isolation), with reason `invalid-plugin-id`. | Test |

## Dependencies

- **Upstream**: StR-001 (implements), FR-001 (requires), FR-005 (requires)

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core/plugins`. Plugins
publish a named export `ixSchema: IxPluginSchema` from their package main; the
host's init hook walks the oclif plugin list and calls `registerPluginSchema`
for each entry. All failure modes return a tagged `PluginSchemaRegistrationResult`
union — the function never throws (per init-failure isolation in §Behavior).

| Symbol                        | Signature                                                                                                      | Returns                                                                                                                                                                                                 | Description                                                                                                                                                                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerPluginSchema`        | `(packageName: string, schema: IxPluginSchema) => PluginSchemaRegistrationResult`                              | `{ ok: true, kind: "registered" \| "idempotent", entry } \| { ok: false, kind: "invalid-package-name" \| "invalid-plugin-id" \| "non-strict-schema" \| "duplicate-registration", packageName, detail }` | Validates `packageName` is non-empty, derives `pluginId` from `schema.id` or a sanitized package name, enforces `^[a-z][a-z0-9-]*$` and Zod `.strict()`, wires `schema.config` into `registerPlugin` (FR-001) and `schema.secrets` into `registerSecretsForPlugin` (FR-005). First wins on duplicate id. |
| `getRegisteredPluginSchema`   | `(packageName: string) => RegisteredPluginSchema \| undefined`                                                 | entry or `undefined`                                                                                                                                                                                    | Lookup by package name.                                                                                                                                                                                                                                                                                  |
| `listRegisteredPluginSchemas` | `() => RegisteredPluginSchema[]`                                                                               | all entries                                                                                                                                                                                             | Used by `config doctor` and `--version --verbose` to surface registration outcomes.                                                                                                                                                                                                                      |
| `IxPluginSchema` (shape)      | `{ id?: string; config?: ZodObject<ZodRawShape>; secrets?: SecretDeclaration[]; env?: Record<string,string> }` | —                                                                                                                                                                                                       | Convention export each plugin publishes as `ixSchema`. `config` MUST be `z.object({...}).strict()`.                                                                                                                                                                                                      |
| `SecretDeclaration` (shape)   | `{ name: string; description: string; required?: boolean; envVar?: string }`                                   | —                                                                                                                                                                                                       | Registered globally as `<pluginId>.<name>`. `envVar`, when set, takes precedence over backend values in `SecretsService.get` (FR-005-AC-1).                                                                                                                                                              |
