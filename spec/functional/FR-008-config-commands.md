---
id: FR-008
title: "config Command Group (get, set, edit, doctor)"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-002"
    type: "requires"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-core` SHALL provide command runners for a `config` command group with four subcommands, which the host binary registers as `<bin> config …`. All output SHALL flow through the host CLI's UI primitives (e.g. `@agent-ix/ix-ui-cli`).

```
config get [<plugin>] <key>
config set [<plugin>] <key> <value>
config edit [<plugin>]
config doctor
```

**`<plugin>` argument.** Optional. When omitted, the reserved id `core` is used. The plugin id MUST match a registered plugin ([FR-004](./FR-004-plugin-schema-registration.md)), otherwise the command fails with `UnknownPluginError` listing the registered plugin ids.

**`get`.** Resolves the value via the layered pipeline ([FR-003](./FR-003-layered-resolution.md)) and prints it. Boolean and number values are rendered as their YAML scalar form. Object/array values are rendered as YAML. Missing keys produce a non-zero exit and a clear "key not set" message including the key path and effective default (if any).

**`set`.** Validates the proposed write against the plugin's schema ([FR-004](./FR-004-plugin-schema-registration.md)) before persisting via `ConfigService.set` ([FR-001](./FR-001-config-service-api.md)). Schema errors are rendered with plugin id, key path, expected type, and file path per [NFR-003](../non-functional/NFR-003-schema-error-ux.md). The serialized YAML is rewritten atomically ([FR-001-AC-2](./FR-001-config-service-api.md)).

**Value parsing.** `<value>` is parsed before schema validation, with parsing mode determined by the **schema shape at the target key path** — never inferred from the argument string:

- **Scalar leaf types** (`string`, `number`, `boolean`, `enum`): the argument is passed as-is to the schema; the schema's `coerce` does the conversion (`"3"` → `3` for a number key, `"true"` → `true` for boolean).
- **Non-scalar leaf types** (`array`, `object`): the argument MUST be valid JSON and is parsed with `JSON.parse()` before schema validation. Single-quote-wrap the JSON in your shell to avoid double-quote escaping: `config set local cluster.defaultTags '["ix-core","ix-data"]'`.

A non-scalar key supplied with non-JSON input fails fast with `ConfigSetParseError` naming the key path and the expected JSON shape (e.g. `array<string>`); the file is not modified.

**`edit`.** Opens the plugin's config file (`ConfigService.forPlugin(...).filePath()`) in `$VISUAL` or `$EDITOR` (default `vi`). On editor exit, the file is parsed and validated; on validation failure the user is offered a re-edit loop or a discard. The file is locked ([FR-002](./FR-002-per-plugin-file-isolation.md)) for the duration of editing so concurrent CLI writes cannot race.

**`doctor`.** Iterates every file under `<config-root>/config.d/` (and the core file at `<config-root>/config.yaml`), validates each against its registered schema, and renders a per-plugin report:

- ✓ valid plugin (file path, key count)
- ✗ failing plugin (file path, list of `{ keyPath, expectedType, message }` errors per [NFR-003](../non-functional/NFR-003-schema-error-ux.md))
- ? unregistered file (file present, no plugin registered for that id) — warning, not error.

`doctor` exits non-zero iff any plugin fails validation; unregistered files alone do not fail it.

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                                                                                                                                                                               | Verification |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-008-AC-1 | `config get logLevel` (no plugin arg) reads from the `core` plugin's resolved config and prints the value.                                                                                                                                                                                                             | Test         |
| FR-008-AC-2 | `config set local cluster.defaultTags '["ix-core","ix-data"]'` validates against the local schema, persists atomically, and the new value is observed on the next read.                                                                                                                                                | Test         |
| FR-008-AC-3 | `config set local cluster.defaultTags 42` fails with a schema error naming plugin `local`, key `cluster.defaultTags`, expected `array<string>`, and file path `<config-root>/config.d/local.yaml`.                                                                                                                     | Test         |
| FR-008-AC-4 | `config edit local` opens the file in `$EDITOR`; on save with malformed content, the user is presented with a re-edit / discard prompt; on accept, the file passes validation.                                                                                                                                         | Test         |
| FR-008-AC-5 | `config doctor` against a tree containing one valid file and one malformed file reports both, exits non-zero, and does not crash.                                                                                                                                                                                      | Test         |
| FR-008-AC-6 | An unknown `<plugin>` argument produces `UnknownPluginError` listing all registered plugin ids and exits non-zero.                                                                                                                                                                                                     | Test         |
| FR-008-AC-7 | Concurrent `config set local …` invocations are serialized by the per-file advisory lock ([FR-002](./FR-002-per-plugin-file-isolation.md)); both writes complete in order.                                                                                                                                             | Test         |
| FR-008-AC-8 | For an array-typed key, `config set local cluster.defaultTags 'ix-core,ix-data'` (non-JSON input) fails with `ConfigSetParseError` naming the key path `cluster.defaultTags` and the expected JSON shape `array<string>`; the destination file is not modified. The same call with `'["ix-core","ix-data"]'` succeeds. | Test         |

## Dependencies

- **Upstream**: [StR-001](../stakeholder/StR-001-pluggable-config-contract.md) (implements), [FR-001](./FR-001-config-service-api.md) (requires), [FR-002](./FR-002-per-plugin-file-isolation.md) (requires)
