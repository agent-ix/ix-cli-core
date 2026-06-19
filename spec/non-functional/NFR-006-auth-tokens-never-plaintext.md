---
id: NFR-006
title: "Auth Tokens Never Persisted in Plaintext"
type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-017"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/non-functional/NFR-001"
    type: "requires"
    cardinality: "1:1"
---

## Statement

Access tokens and refresh tokens managed by the auth engine's `TokenStore`
([FR-017](../functional/FR-017-host-keyed-token-store.md)) SHALL be persisted **only** through the framework `SecretsService`
([FR-005](../functional/FR-005-secrets-service-api.md)) — i.e. via the sanctioned OS-keyring or age-encrypted backends. They
SHALL NOT be written to any plaintext file, including the metadata store, config
files, logs, or process output. This extends [NFR-001](./NFR-001-no-plaintext-secrets.md) to the auth engine: the
token bundle's secret material reuses the exact persistence channels [NFR-001](./NFR-001-no-plaintext-secrets.md)
already governs.

Only **non-sensitive** metadata (`expiresAt`, `audience`, `scope`) may be
persisted outside the secrets backend (in the host CLI's config plugin). Token
values MUST NOT appear in that metadata.

## Rationale

The `TokenStore` deliberately splits a login bundle into "secret" (the tokens)
and "metadata" (expiry/audience/scope) precisely so the refresh-before-expiry
decision can be made from plaintext metadata without ever placing tokens on
disk. Routing tokens through `SecretsService` inherits keyring/age encryption,
0600 file modes, and the no-plaintext guarantee at zero additional cost; writing
them anywhere else would silently break that guarantee.

## Measurement and Evaluation

| Metric                                                                                                                         | Target | Threshold | Method                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ------ | --------- | -------------------------------------- |
| Token value present in the serialized metadata store after `save`                                                              | 0      | 0         | Test (NFR-006-AC-1)                    |
| `TokenStore` token write paths outside `SecretsService.set` (`fs.*`/`process.stdout`/`console.*`) in `src/auth/token-store.ts` | 0      | 0         | Inspection (code review, NFR-006-AC-2) |

## Acceptance Criteria

- **NFR-006-AC-1**: A unit test SHALL `save` a bundle, then assert the token
  value is retrievable from the secrets backend under the host-keyed access
  `SecretId` and is **absent** from the serialized metadata store.
- **NFR-006-AC-2**: A static review SHALL confirm `TokenStore` writes token
  values only via `SecretsService.set` (no `fs.*` / `process.stdout` / `console.*`
  sinks for token material in `src/auth/token-store.ts`).

## Verification

- NFR-006-AC-1 is covered by `auth-token-store.test.ts`
  ("stores metadata (expiry/audience) separately from the secret").
- NFR-006-AC-2 is a code-review check over `src/auth/token-store.ts`, whose only
  token write path is `this.secrets.set(...)`.
