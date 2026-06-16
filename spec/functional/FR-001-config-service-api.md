---
id: FR-001
title: "ConfigService API in @agent-ix/ix-cli-core"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-002"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-004"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

`@agent-ix/ix-cli-core` SHALL export a `ConfigService` whose only public entry point is:

```typescript
ConfigService.forPlugin<T>(pluginId: string, schema: ZodSchema<T>): PluginConfig<T>
```

`PluginConfig<T>` exposes:

```typescript
interface PluginConfig<T> {
  get(): T; // returns merged-with-defaults, validated value
  set(partial: Partial<T>): void; // deep-merges, validates, atomically writes
  replace(value: T): void; // overwrites whole value, validates, atomically writes
  reset(): void; // deletes the plugin's file (returns to defaults)
  filePath(): string; // for `config edit`
}
```

**`set` vs `replace`.** `set` deep-merges its patch into the existing
on-disk content (objects recurse, arrays replace wholesale). That
makes additions and overrides ergonomic but means absent keys are a
no-op — `set({ map: {} })` cannot delete entries from an existing
`map`. Callers that need deletion must use `replace`, which validates
the full value and writes it verbatim. Both go through the same
atomic temp+rename + `ConfigSchemaError` handling.

**File layout.** Each plugin's persisted config lives in its own file under `<config-root>/` (default `~/.config/ix/`):

- For third-party and first-party plugins: `<config-root>/config.d/<pluginId>.yaml`.
- For the reserved `core` plugin (owned by the host binary): `<config-root>/config.yaml`.

The placement difference is the only special case in `ConfigService`; isolation, atomic writes, and schema validation behave identically for both paths. `forPlugin('core', schema)` resolves to the `config.yaml` path; all other ids resolve to `config.d/<id>.yaml`.

**Atomic writes.** `set()` writes to a sibling temp file (`<pluginId>.yaml.tmp.<pid>`) with mode `0o600`, fsyncs, then renames over the target. The temp file is unlinked on any failure path.

**Schema enforcement.** Schemas SHALL be Zod `.strict()` (per FR-004); writes that introduce unknown keys SHALL throw `ConfigSchemaError`. Reads of an existing-but-invalid file SHALL throw `ConfigParseError`; the loader callsite (FR-002) decides whether to fall back to defaults.

**No cross-plugin reads.** The API SHALL NOT expose a method that reads another plugin's file; a plugin holding `PluginConfig<T>` for its own id has no path to `pluginId`s belonging to other plugins.

**Versioning.** Each plugin file MAY carry a top-level `version:` field. v1 schemas omit it; future migrations MAY use it.

**Filesystem failure modes.**

- _Read-only target directory_: when `<config-root>/` (or its parent) is not writable, `set()` SHALL throw `ConfigWriteError` wrapping the underlying `EACCES`/`EROFS`/`ENOSPC` and naming the target path. The pre-existing file content is unaffected; the temp file is unlinked. The error message SHALL include actionable remediation (`chmod`, free disk, etc.).
- _Windows cross-drive rename_: `fs.rename()` is not atomic across drives on Windows. To preserve atomicity, the temp file SHALL be created in the **same directory** as the target (sibling, not in `os.tmpdir()`). This guarantees temp+rename stays on the same volume regardless of platform. Implementations MUST NOT use `os.tmpdir()` for governed-file temp paths.
- _Symlinked target_: refused on read per NFR-002-AC-4; on write, the symlink is detected before any operation and refused with `ConfigSymlinkRefusedError` naming both the symlink path and its target.
- _Concurrent crash mid-rename_: POSIX `rename(2)` is atomic; either the old or new content is observable, never a partial. The temp file MAY be left orphaned; `ConfigService` SHALL prune `<file>.tmp.*` siblings older than 30s on next operation against the same plugin file.

## Acceptance

- **FR-001-AC-1**: `ConfigService.forPlugin('local', LocalSchema).get()` reads only `<config-root>/config.d/local.yaml`; `forPlugin('core', CoreSchema).get()` reads only `<config-root>/config.yaml`. Reading any other plugin's file requires a separate `forPlugin(...)` call with that plugin id (subject to the soft-isolation contract documented in spec.md §10 — runtime cross-plugin reads are not API-blocked but are flagged by static check).
- **FR-001-AC-2**: `set({...})` produces an atomic on-disk write — the target file is replaced via temp + rename; an interrupted write leaves the previous content intact and removes the temp file.
- **FR-001-AC-3**: All files written by `set()` have mode `0o600` regardless of umask.
- **FR-001-AC-4**: Calling `set({ unknownKey: 1 })` against a `.strict()` schema throws `ConfigSchemaError` and does not modify the file.
- **FR-001-AC-5**: `reset()` deletes the file; a subsequent `get()` returns the schema defaults and re-creates the file only on the next `set()`.
- **FR-001-AC-6**: `filePath()` returns the absolute path of the plugin's config file (used by `config edit`).
- **FR-001-AC-7** _(read-only filesystem)_: When the target directory is unwritable (`EACCES`/`EROFS`/`ENOSPC`), `set()` throws `ConfigWriteError` naming the path and underlying errno; the existing file content (if any) is unchanged; no orphan temp file remains.
- **FR-001-AC-8** _(temp file is a sibling)_: Temp files are created in the same directory as the target file (`<target>.tmp.<pid>.<rand>`). A test that mocks `os.tmpdir()` to a different volume confirms that no write path uses it for governed-file temp.
- **FR-001-AC-9** _(orphan temp pruning)_: `ConfigService` prunes `<target>.tmp.*` siblings older than 30 seconds on the next `set()` for the same plugin id. Younger orphans are left alone (another writer may be mid-flight).
- **FR-001-AC-10** _(`replace` semantics)_: `replace(value)` writes `value` verbatim — absent keys at any depth are removed from the on-disk content. Validates against the plugin's schema first; on schema failure throws `ConfigSchemaError` and does not modify the file. Same atomic-write + locking behavior as `set`. Used by callers that need to express deletions (e.g. removing an entry from a `Record<string, …>` map).

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (no HTTP surface).
The only public entry point is the static `ConfigService.forPlugin` factory; the
returned `PluginConfig<T>` object exposes the read/write methods. Errors are
thrown as typed subclasses of `ConfigError` (`ConfigSchemaError`,
`ConfigParseError`, `ConfigWriteError`, `ConfigSymlinkRefusedError`).

| Symbol                    | Signature                                                                                                                          | Returns           | Description                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConfigService.forPlugin` | `<S extends ZodRawShape>(pluginId: string, schema: ZodObject<S>, opts?: ForPluginOptions) => PluginConfig<z.infer<typeof schema>>` | `PluginConfig<T>` | Returns a typed accessor bound to `pluginId`. Auto-registers the plugin in the global registry for `doctor()`. Reserved id `core` resolves to `<config-root>/config.yaml`; any other id resolves to `<config-root>/config.d/<id>.yaml`.                                                                                                                                                             |
| `PluginConfig.get`        | `() => T`                                                                                                                          | `T`               | Reads env → file → schema defaults (FR-003). Parse/validation failures are recorded as incidents and defaults are returned; never throws (FR-002-AC-1).                                                                                                                                                                                                                                             |
| `PluginConfig.set`        | `(partial: Partial<T>) => void`                                                                                                    | `void`            | Deep-merges `partial` into current on-disk content (arrays replace wholesale), validates against the strict schema, then atomically writes via temp+rename with mode `0o600`. Throws `ConfigSchemaError` on validation failure, `ConfigWriteError` on `EACCES`/`EROFS`/`ENOSPC`, `ConfigSymlinkRefusedError` if the target is a symlink. Serialized under the per-file advisory lock (FR-002-AC-4). |
| `PluginConfig.replace`    | `(value: T) => void`                                                                                                               | `void`            | Same atomic-write + locking as `set`, but writes `value` verbatim — absent keys are removed. Use to delete map entries.                                                                                                                                                                                                                                                                             |
| `PluginConfig.reset`      | `() => void`                                                                                                                       | `void`            | `unlink` the plugin's file (`ENOENT` is a no-op). Next `get()` returns schema defaults.                                                                                                                                                                                                                                                                                                             |
| `PluginConfig.filePath`   | `() => string`                                                                                                                     | `string`          | Absolute path of the plugin's config file (used by `config edit`).                                                                                                                                                                                                                                                                                                                                  |
