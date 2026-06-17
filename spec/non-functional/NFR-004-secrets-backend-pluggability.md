---
id: NFR-004
title: "Secrets Backend Adapter Pluggability"
type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-005"
    type: "requires"
    cardinality: "1:1"
---

## Statement

`SecretsService` SHALL be implemented against a `SecretsBackend` interface so that additional adapters (HashiCorp Vault, 1Password, Bitwarden, AWS/GCP Secret Manager, etc.) can be added in future versions without changes to consumer code.

**Interface contract.**

```typescript
interface SecretsBackend {
  readonly id: "keyring" | "age-file" | string; // additional ids reserved for future
  probe(): Promise<{ available: boolean; reason?: string }>;
  get(secretId: SecretId): Promise<string | null>;
  set(secretId: SecretId, value: string): Promise<void>;
  delete(secretId: SecretId): Promise<void>;
  list(): Promise<Array<{ secretId: SecretId }>>;
}
```

**Selection.** The active backend is selected by `core.secretsBackend` ([FR-003](../functional/FR-003-layered-resolution.md)):

- `auto` — keyring if `probe()` succeeds, else age-file.
- `keyring` — pin to keyring; if `probe()` fails, every secret op throws.
- `age-file` — pin to age-file regardless of keyring availability.
- (future) `vault`, `1password`, `bitwarden`, etc. — registered by future adapter packages; their `id` strings are reserved.

**Consumer constraints.**

- Consumers (first-party packages, third-party plugins) SHALL only call the public `SecretsService` API. They MUST NOT import `SecretsBackend` implementations directly.
- A static check SHALL prevent `import.*backends/(keyring|age-file)` from any file outside `src/secrets/`.

**Adapter packaging.** v1 ships only `keyring` and `age-file` as in-tree backends. Future external adapters (e.g. `@agent-ix/ix-cli-secrets-vault`) register via a documented `registerSecretsBackend(adapter: SecretsBackend)` entrypoint exposed from core. A registered backend whose `id` is already taken throws.

**Forward compatibility.** Adding a new backend SHALL NOT require changes to:

- Consumer code that reads/writes secrets through `SecretsService`
- The `secrets` command surface ([FR-009](../functional/FR-009-secrets-commands.md))
- The `SecretDeclaration` / `ixSchema.secrets` shape (declarative metadata)
- `SecretsService` public method signatures

## Rationale

Today's open question is "keyring vs Vault vs Bitwarden". The answer for v1 is keyring + age-file because that's the model `gh`, `aws`, `gcloud` use and it's the minimum that solves the plaintext problem. But teams will eventually want centralized rotation, audit, and dynamic credentials from Vault — and individual users may prefer Bitwarden or 1Password sync. A backend adapter interface keeps that door open with zero refactor risk to consumers.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Changes to `SecretsService` / consumers required to add a new conforming backend | 0 | 0 | Demonstration (in-test `MemoryBackend`, NFR-004-AC-1, NFR-004-AC-2) |
| Imports of `secrets/backends/*` from outside `src/secrets/` | 0 | 0 | Analysis (static grep, NFR-004-AC-3) |
| Duplicate-`id` backend registrations that succeed | 0 | 0 | Test (NFR-004-AC-4) |
| Silent age-file fallback when `keyring` is pinned and the probe fails | 0 | 0 | Test (NFR-004-AC-5) |

## Acceptance Criteria

- **NFR-004-AC-1**: A test harness defines a `MemoryBackend` satisfying `SecretsBackend`, registers it via the backends map, sets `core.secretsBackend = "memory"`, and exercises `set/get/delete/list/which` end-to-end without any change to `SecretsService` or its consumers.
- **NFR-004-AC-2**: Consumers compile and pass tests against the unchanged `SecretsService` API when `core.secretsBackend` switches between `keyring` and `age-file`.
- **NFR-004-AC-3**: A static grep SHALL find zero imports of `secrets/backends/*` from outside `src/secrets/`.
- **NFR-004-AC-4**: Registering two backends with the same `id` throws on the second registration; the first remains active.
- **NFR-004-AC-5**: With `core.secretsBackend = "keyring"` pinned and the probe failing, every `SecretsService` operation throws `KeyringUnavailableError` (no silent fallback to age-file).

## Verification

- Unit tests implement NFR-004-AC-1, NFR-004-AC-2, NFR-004-AC-4, NFR-004-AC-5 with the in-test `MemoryBackend`.
- A static-check test enforces NFR-004-AC-3 via grep.
