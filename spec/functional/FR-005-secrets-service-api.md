---
id: FR-005
title: "SecretsService API in @agent-ix/ix-cli-core"
artifact_type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-004"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-006"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-007"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/non-functional/NFR-001"
    type: "requires"
    cardinality: "1:1"
---

## Behavior

`@agent-ix/ix-cli-core` SHALL export a `SecretsService` with the following public API:

```typescript
interface SecretsService {
  get(id: SecretId, opts?: { prompt?: boolean }): Promise<string | null>;
  set(id: SecretId, value: string): Promise<void>;
  delete(id: SecretId): Promise<void>;
  which(id: SecretId): Promise<"env" | "keyring" | "age-file" | "unset">;
  list(): Promise<
    Array<{
      id: SecretId;
      backend: "keyring" | "age-file";
      description: string;
    }>
  >;
}

type SecretId = `${string}.${string}`; // "<plugin-id>.<secret-name>"
```

**SecretId runtime validation.** TypeScript's template-literal type is erased at runtime and would accept malformed ids (`"."`, `".x"`, `"a.b.c"`). Every public `SecretsService` method that accepts a `SecretId` SHALL validate it against the regex `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$` and throw `InvalidSecretIdError` on mismatch. The plugin id and secret name are each lowercase ASCII, start with a letter, contain only letters/digits/hyphens, and are separated by exactly one `.`.

**Resolution order for `get()`.** Highest precedence first:

1. **Environment variable** declared by the secret's `envVar` binding (FR-004) — e.g. `IX_GHCR_TOKEN`.
2. **Active backend** — keyring (FR-006) when capability probe succeeds, age-file (FR-007) when it does not.
3. **Interactive prompt** — only when `opts.prompt === true` and stdin/stdout is a TTY. The prompt SHALL be masked. The prompted value SHALL be persisted to the active backend after collection.
4. Otherwise, return `null`.

**`set()` and `delete()`** SHALL target the active backend; env-var-only secrets cannot be `set` (the API throws `SecretBackendImmutableError` if `envVar` is bound and set).

**Backend selection.** The active backend is chosen by the `core.secretsBackend` config value (FR-003), which defaults to `auto` (= keyring if the capability probe succeeds, else age-file). Operators may pin to `keyring` or `age-file` explicitly.

**Backend pluggability.** `SecretsService` SHALL be implemented against a `SecretsBackend` interface so that future adapters (Vault, 1Password, Bitwarden) can be registered without changing consumer code (per NFR-004). v1 ships only `keyring` and `age-file`.

**No value logging.** `SecretsService` MUST NOT log secret values, MUST NOT include them in error messages, and MUST NOT pass them to `console.*`. It SHALL render only the secret id and selected backend.

## Acceptance

- **FR-005-AC-1**: With `IX_GHCR_TOKEN=abc` set, `get('local.ghcr-token')` returns `"abc"` and `which('local.ghcr-token')` returns `"env"`, regardless of what is in any backend.
- **FR-005-AC-2**: With env unset and the value present in the active backend, `get(...)` returns the backend value.
- **FR-005-AC-3**: With env unset, no backend value, and `opts.prompt === true` on a TTY, the user is prompted with masked input; the entered value is persisted to the active backend and returned.
- **FR-005-AC-4**: With env unset, no backend value, and `opts.prompt !== true` (or non-TTY), `get(...)` returns `null` without prompting.
- **FR-005-AC-5**: `set('foo.bar', value)` followed by `delete('foo.bar')` results in `which('foo.bar') === 'unset'`.
- **FR-005-AC-6**: `set(...)` against a secret whose `envVar` binding is currently set in the environment throws `SecretBackendImmutableError`.
- **FR-005-AC-7**: A test scan of compiled output and runtime logs SHALL detect zero occurrences of any secret value emitted by `SecretsService`.
- **FR-005-AC-8**: Every public method receiving a `SecretId` validates it against `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`. Malformed ids (`"."`, `".x"`, `"x."`, `"A.b"`, `"a.b.c"`, `"a..b"`) throw `InvalidSecretIdError` naming the offending input (full input rendered, since it is, by definition, not a value).

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core/secrets`. There is
no HTTP surface — `SecretsService` brokers between the resolved active backend
(`keyring`, `age-file`, or test-only `memory`) and the registered secret
declarations from FR-004. Every method validates `SecretId` against
`^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$` and throws `InvalidSecretIdError` on
mismatch (FR-005-AC-8).

| Symbol                                     | Signature                                                                                                                                  | Returns                | Description                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new SecretsService`                       | `(opts?: { mode?: SecretsBackendMode; backends?: Map<string, SecretsBackend>; env?: Record<string,string\|undefined> }) => SecretsService` | instance               | `mode` defaults to `"auto"` (keyring → age-file probe order). Pinned `"keyring"` with a failing probe throws `KeyringUnavailableError` on first use (NFR-004-AC-5); pinned `"age-file"` falls through to backend.get. |
| `SecretsService.get`                       | `(id: SecretId) => Promise<string \| null>`                                                                                                | secret value or `null` | Resolution order: env var declared by `SecretDeclaration.envVar` → active backend → `null`. Empty/whitespace env values are treated as unset. Never logs or rethrows the value.                                       |
| `SecretsService.set`                       | `(id: SecretId, value: string) => Promise<void>`                                                                                           | `void`                 | Writes to the active backend. Throws `SecretBackendImmutableError` if the env shadow (`envVar`) is currently set (FR-005-AC-6).                                                                                       |
| `SecretsService.delete`                    | `(id: SecretId) => Promise<void>`                                                                                                          | `void`                 | Deletes from the active backend; env-shadowed secrets remain resolvable via env.                                                                                                                                      |
| `SecretsService.which`                     | `(id: SecretId) => Promise<'env' \| 'keyring' \| 'age-file' \| 'unset' \| string>`                                                         | source                 | Reports the source that would satisfy a `get` right now. Returns `"env"` whenever the bound env var is set, regardless of backend state (FR-009-AC-3).                                                                |
| `SecretsService.list`                      | `() => Promise<Array<{ id; backend; source; description }>>`                                                                               | snapshot               | All registered secrets with their current `which()` source. Never includes values (FR-009-AC-1). Sorted by id.                                                                                                        |
| `SecretsService.activeBackend`             | `() => Promise<SecretsBackend>`                                                                                                            | adapter                | Forces probe-and-select if not yet performed; throws `KeyringUnavailableError` when no backend is selectable.                                                                                                         |
| `SecretsService.assertRegistered` (static) | `(id: string) => void`                                                                                                                     | `void`                 | Throws `UnknownSecretError` with the sorted list of known ids if `id` is not registered. Used at command boundaries (FR-009-AC-5).                                                                                    |
