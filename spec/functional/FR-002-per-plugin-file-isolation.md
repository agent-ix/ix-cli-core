---
id: FR-002
title: "Per-Plugin File Isolation and Scoped Failure"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/non-functional/NFR-003"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

Each plugin's persisted config MUST be physically isolated in its own YAML file at `<config-root>/config.d/<pluginId>.yaml`. The `ConfigService` (FR-001) MUST enforce the following isolation guarantees:

**Scoped failure on parse / validation errors.**

- A YAML parse error in `config.d/<a>.yaml` SHALL NOT prevent `config.d/<b>.yaml` (any other plugin) from loading.
- A schema validation error against plugin A's loaded content SHALL cause plugin A's `get()` to return schema defaults (not throw at the loader callsite), and the error SHALL be recorded for surfacing by `config doctor` (FR-008).
- The first `set()` after a defaulted load SHALL overwrite the broken file with a valid serialization.

**Same-plugin write serialization.**

- Writes to `config.d/<id>.yaml` SHALL be serialized via an advisory lockfile at `config.d/<id>.yaml.lock` (acquired with `O_CREAT | O_EXCL`, removed in `finally`). A second process attempting to write the same plugin's config SHALL block until the first releases, with a configurable timeout (default 5s) after which it throws `ConfigLockTimeoutError`.
- Writes to _different_ plugin files SHALL NOT contend on each other; two processes editing different plugins SHALL succeed concurrently.

**Doctor surface.**

- `ConfigService.doctor()` SHALL iterate every file in `config.d/`, attempt to parse and validate against the corresponding registered schema, and return `{ pluginId, filePath, errors[] }` for each failing file. It SHALL NOT throw.

**Stale-lock cleanup.**

- Lock files older than the configured timeout (default 30s) belonging to a non-existent or non-running pid SHALL be removed automatically before acquisition.

## Acceptance

- **FR-002-AC-1**: Given a malformed `config.d/local.yaml` and a valid `config.d/elements.yaml`, calling `forPlugin('elements', S).get()` succeeds and returns the parsed value; calling `forPlugin('local', S).get()` returns `LocalSchema` defaults.
- **FR-002-AC-2**: After a defaulted load triggered by FR-002-AC-1, `forPlugin('local', S).set({...})` overwrites the malformed file with a valid serialization.
- **FR-002-AC-3**: `ConfigService.doctor()` returns one entry per failing file with `pluginId`, `filePath`, and a non-empty `errors[]` array; it does not throw.
- **FR-002-AC-4**: Two concurrent `set()` calls on the same plugin id are serialized — one returns first, the other waits for the lock — and both writes are persisted in order.
- **FR-002-AC-5**: Two concurrent `set()` calls on _different_ plugin ids both complete without lock contention.
- **FR-002-AC-6**: A lockfile owned by a non-running pid is reaped before a fresh acquisition; no operator intervention required.
- **FR-002-AC-7**: A `set()` that cannot acquire the lock within the configured timeout throws `ConfigLockTimeoutError` naming the plugin id and lockfile path.
