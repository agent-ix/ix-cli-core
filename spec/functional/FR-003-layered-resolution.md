---
id: FR-003
title: "Layered Config Resolution: Env → Plugin File → Defaults"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-001"
    type: "requires"
    cardinality: "1:1"
---

## Description

`ConfigService.forPlugin(...).get()` SHALL resolve effective values from the following layers, highest precedence first:

1. **Environment variables** declared by the plugin's schema via Zod metadata or a sibling `envBindings` map (e.g. `IX_LOG_LEVEL` for `core.logLevel`, `IX_GHCR_REGISTRY` for `local.registry`). Env values are coerced and validated by the same schema.
2. **The plugin's user-config file** at `<config-root>/config.d/<pluginId>.yaml`.
3. **Schema defaults** as declared by the Zod schema.

Env-variable bindings are conventionally `IX_*` and SHALL be declared by the plugin (not hardcoded in core), so a plugin can choose its own envvar names while still benefiting from layered resolution.

**Core-only settings.** Settings owned by the host binary itself (log level, secrets backend choice, telemetry opt-in, etc.) are persisted under the reserved plugin id `core` at `<config-root>/config.yaml` (note: file directly named `config.yaml`, not under `config.d/`). The reserved id `core` is the only plugin allowed to write that path.

**Project-local layer (deferred to v2).** A `./.ix/config.d/<pluginId>.yaml` layer between env and user file is explicitly out of scope for v1; the resolution pipeline is structured to admit it later without API change.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-003-AC-1 | With `IX_LOG_LEVEL=debug` set and `<config-root>/config.yaml` containing `logLevel: info`, `forPlugin('core', S).get().logLevel === 'debug'`. | Test |
| FR-003-AC-2 | With `IX_LOG_LEVEL` unset and `<config-root>/config.yaml` containing `logLevel: info`, `get().logLevel === 'info'`. | Test |
| FR-003-AC-3 | With both env and file absent, `get()` returns the schema-declared default for each key. | Test |
| FR-003-AC-4 | An invalid env-variable value (e.g. `IX_LOG_LEVEL=loud`) raises `ConfigSchemaError` with the env var name and expected enum. | Test |
| FR-003-AC-5 | Plugin source code outside the host binary and `@agent-ix/ix-cli-core` SHALL contain zero call sites of the form `ConfigService.forPlugin('core', ...)` or `forPlugin('<other-plugin-id>', ...)` (verified by static check). The `ConfigService` API does NOT runtime-reject such calls — see spec.md §10 trust model — but a static lint enforces the soft contract that each plugin only reads its own id. | Analysis |

## Dependencies

- **Upstream**: [StR-001](../stakeholder/StR-001-pluggable-config-contract.md) (implements), [FR-001](./FR-001-config-service-api.md) (requires)

