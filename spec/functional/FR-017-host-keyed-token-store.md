---
id: FR-017
title: "Host-Keyed Token Store with Refresh-Before-Expiry"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-005"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-015"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-016"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/non-functional/NFR-005"
    type: "requires"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-core` SHALL export a `TokenStore` that persists the token
bundle from a device-flow login ([FR-016](./FR-016-device-flow-runner.md)) **per host**, brokered through the
framework `SecretsService` ([FR-005](./FR-005-secrets-service-api.md)) so tokens are never plaintext on disk
([NFR-001](../non-functional/NFR-001-no-plaintext-secrets.md)), and resolves a usable access token on demand — refreshing before
expiry and rotating the stored refresh token.

```typescript
class TokenStore {
  constructor(opts: TokenStoreOptions);
  save(host: string, bundle: TokenBundle): Promise<void>;
  clear(host: string): Promise<void>;
  clearBySlug(slug: string): Promise<void>;
  peekMeta(host: string): TokenMeta | undefined;
  peekMetaBySlug(slug: string): TokenMeta | undefined;
  peekAccessToken(host: string): Promise<string | null>;
  getAccessToken(host: string, opts?: GetAccessTokenOptions): Promise<string>;
}
```

**Addressing by slug vs. host.** Host-taking methods (`save`/`clear`/`peekMeta`)
slugify their argument. When a caller enumerates stored entries it sees the
**slug keys** of the `TokenMetaStore` (not raw hosts); re-slugifying a slug
would hash it a second time and miss the entry. `clearBySlug` / `peekMetaBySlug`
therefore address an already-slugified key directly. `save` records the original
`host` in `TokenMeta` so enumerating callers can render a human-readable host
(the slug is hash-discriminated and not meant for display).

**Host keying.** Each host's access and refresh tokens are stored under
distinct `SecretId`s derived from the host: `<plugin>.auth-access-token-<slug>`
and `<plugin>.auth-refresh-token-<slug>`, where `<plugin>` defaults to `core`
and `<slug>` is the host slugified to satisfy the `SecretId` name regex
(`hostSlug`). The slug SHALL be **injective**: two distinct host authorities
SHALL NOT produce the same slug, even when their readable forms differ only by
a separator (e.g. `foo.bar.dev.ix` vs `foo-bar.dev.ix`). `hostSlug` therefore
appends a short deterministic discriminator derived from the full authority to
a readable prefix. Logging into one host SHALL NOT read or mutate another
host's tokens (host isolation, [NFR-005](../non-functional/NFR-005-auth-host-isolation-tls.md)).

**Token / metadata split.** The access and refresh tokens go to the
`SecretsService` backend (keyring / age-file). Non-sensitive metadata
(`expiresAt`, `audience`, `scope`) is persisted through an injectable
`TokenMetaStore` (the host CLI backs it with its config plugin). Token values
SHALL NOT be written to the metadata store.

**`getAccessToken(host)`.**

- If a stored access token exists and its `expiresAt` is more than the
  refresh-skew window (default 5 minutes) in the future, return it without any
  network call.
- Otherwise, if a refresh token is stored, the store SHALL `POST` the discovery
  doc's `token_refresh_endpoint` (`grant_type=refresh_token`,
  `refresh_token=<stored>`), persist the resulting bundle, and return the new
  access token. The discovery doc MAY be supplied by the caller or fetched via
  [FR-015](./FR-015-service-discovery-client.md).
- **Rotation.** When the refresh response carries a new `refresh_token`, the
  store SHALL persist it in place of the old one; when it does not, the existing
  refresh token SHALL be preserved.
- If no refresh token is stored but a (near-expiry) access token is, the store
  MAY return that access token rather than failing (the caller re-logs-in on a
  401). If nothing is stored, it SHALL throw `NotAuthenticatedError`.
- A failed refresh (non-2xx, bad JSON, or no `access_token`) SHALL throw
  `TokenRefreshError`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-017-AC-1 | `save(hostA, …)` then `save(hostB, …)` yields independent `peekAccessToken` results; `clear(hostA)` removes hostA's tokens and leaves hostB's intact. | Test |
| FR-017-AC-2 | After `save`, the metadata store contains only `{expiresAt, audience, scope}` and NOT the token value; the access token is retrievable from the secrets backend under the host-keyed `…auth-access-token-<slug>` id. | Test |
| FR-017-AC-3 | `getAccessToken` returns the stored token with no `fetch` call when the token is outside the refresh-skew window. | Test |
| FR-017-AC-4 | When the stored token is within the skew window and a refresh token is present, `getAccessToken` posts the `token_refresh_endpoint`, returns the refreshed access token, persists the rotated refresh token, and updates `expiresAt`. | Test |
| FR-017-AC-5 | A refresh response without a new `refresh_token` preserves the previously stored refresh token. | Test |
| FR-017-AC-6 | `getAccessToken` with no stored material throws `NotAuthenticatedError`; a failing refresh throws `TokenRefreshError`. | Test |
| FR-017-AC-7 | `hostSlug(host)` always returns a string matching `^[a-z][a-z0-9-]*$` (valid `SecretId` name segment) for dotted hosts, hosts with ports, and hosts whose first character is non-alphabetic. | Test |
| FR-017-AC-8 | `hostSlug` is injective — two distinct host authorities that collapse to the same readable form (e.g. `foo.bar.dev.ix` and `foo-bar.dev.ix`) produce different slugs, and is deterministic for the same host ([NFR-005-AC-2](../non-functional/NFR-005-auth-host-isolation-tls.md)). | Test |

## Dependencies

- **Upstream**: [StR-002](../stakeholder/StR-002-secrets-never-plaintext.md) (implements), [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [FR-005](./FR-005-secrets-service-api.md) (requires), [FR-015](./FR-015-service-discovery-client.md) (requires), [FR-016](./FR-016-device-flow-runner.md) (requires), [NFR-005](../non-functional/NFR-005-auth-host-isolation-tls.md) (requires)

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (`src/auth/`).
Persistence is delegated to `SecretsService` (no new file channels); the only
outbound call is the refresh `POST` to the discovery doc's
`token_refresh_endpoint`.

| Symbol                      | Signature                                 | Returns      | Description                                                                             |
| --------------------------- | ----------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| `new TokenStore`            | `(opts: TokenStoreOptions) => TokenStore` | instance     | Wraps a `SecretsService` + `TokenMetaStore`; `pluginId` defaults to `"core"`.           |
| `TokenStore.save`           | `(host, bundle) => Promise<void>`         | `void`       | Persists access/refresh secrets host-keyed + metadata.                                  |
| `TokenStore.getAccessToken` | `(host, opts?) => Promise<string>`        | access token | Refresh-before-expiry + rotation. Throws `NotAuthenticatedError` / `TokenRefreshError`. |
| `TokenStore.clear`          | `(host) => Promise<void>`                 | `void`       | Forgets host tokens + metadata (idempotent).                                            |
| `hostSlug`                  | `(host: string) => string`                | slug         | Slugifies a host into a `SecretId`-name-safe segment.                                   |
