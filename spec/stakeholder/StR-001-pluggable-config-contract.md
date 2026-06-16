---
id: StR-001
title: "Pluggable Config Contract with Per-Plugin Isolation"
type: StR
relationships: []
---

## Stakeholder Need

Every CLI built on the Agent IX framework that needs persistent configuration would otherwise roll its own loader: each package parses its own YAML file ad-hoc, picks its own path, and re-implements validation. Plugins (npm packages that extend a CLI) have no shared way to declare a config shape, so every new plugin re-implements YAML reading, path-picking, and validation. This guarantees drift, makes a uniform `config` command impossible, and means a single bad write to a shared file can corrupt config belonging to unrelated plugins.

**Stakeholders** — first-party package authors and third-party plugin authors building on `@agent-ix/ix-cli-core` — need:

1. A single, schema-validated config service in `@agent-ix/ix-cli-core` that every package and plugin uses.
2. A way for each plugin to declare its config shape once (a typed/Zod schema) and have the framework enforce it on read and write.
3. **Physical isolation per plugin**: each plugin's config is stored in its own file under `<config-root>/config.d/<plugin-id>.yaml`, so a malformed or buggy plugin cannot corrupt config belonging to other plugins, and concurrent CLI invocations editing different plugins never contend on the same file.
4. Uniform `config get/set/edit/doctor` commands that work for any plugin without per-plugin code.

## Priority

Must-Have

## Acceptance

- **StR-001-AC-1**: A single `ConfigService` API in `@agent-ix/ix-cli-core` is the only sanctioned way to read or write persistent CLI configuration; every consuming package and binary uses it exclusively.
- **StR-001-AC-2**: A plugin declares its config shape via an optional `config` schema on its `ixSchema` export; the framework validates writes against that schema and rejects unknown keys.
- **StR-001-AC-3**: Each plugin's persisted config lives in its own file under `<config-root>/`. Third-party and first-party plugins use `<config-root>/config.d/<plugin-id>.yaml`; the reserved `core` plugin (owned by the host binary) uses `<config-root>/config.yaml`. The same per-file isolation guarantees apply to both paths.
- **StR-001-AC-4**: A parse or validation error in one plugin's config file SHALL NOT prevent any other plugin from loading; the affected plugin falls back to schema defaults and the error is surfaced via `config doctor`.
- **StR-001-AC-5**: `config get/set/edit/doctor` commands operate uniformly across all registered plugins with no per-plugin command code.
