---
id: NFR-005
title: "Auth Host Isolation and TLS-Only Discovery"
type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-015"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-017"
    type: "requires"
    cardinality: "1:1"
---

## Statement

The auth engine SHALL enforce two isolation properties:

1. **Host isolation.** Tokens, refresh tokens, and metadata are keyed by host.
   The engine SHALL NOT read or write one host's credentials when operating on
   another. A login or refresh against host A SHALL leave host B's stored
   material byte-for-byte unchanged. Host keying is realized by deriving a
   distinct `SecretId` per host (`hostSlug`) for the access and refresh secrets,
   and a distinct metadata key per host (FR-017).

2. **TLS-only discovery.** Service discovery (FR-015) SHALL fetch
   `/.well-known/agentix-service.json` over `https` only. Plain `http` is
   refused **unless** the host is a `dev.ix` / `*.dev.ix` development host or the
   caller explicitly opts in via `--insecure` (`fetchServiceDiscovery({ insecure: true })`).
   The refusal SHALL occur before any network request is made.

## Rationale

A developer routinely logs into multiple Agent IX services (Filament, a local
cluster, a hosted tenant) from one machine. Cross-host bleed would let a token
minted for one audience be presented to another, defeating the per-service
audience binding. Per-host `SecretId`s make isolation a property of the storage
key, not of careful call-site discipline.

Device-flow bootstrap fetches endpoints from a remote document; serving that
document over plain HTTP would let a network attacker rewrite the
`device_authorization_endpoint` / `token_refresh_endpoint` and harvest grants.
TLS is therefore mandatory, with a narrow, explicit carve-out for local `.dev.ix`
development where certificates are inconvenient.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| One host's stored material altered by a `save`/`clear` against a different host | 0 bytes | 0 bytes | Test (NFR-005-AC-1) |
| Shared `SecretId` between access/refresh secrets of two distinct hosts | 0 | 0 | Test (NFR-005-AC-2) |
| Plain-`http` non-`dev.ix` discovery requests reaching the network | 0 | 0 | Test (no-fetch-on-refusal, NFR-005-AC-3) |

## Acceptance Criteria

- **NFR-005-AC-1**: A unit test SHALL `save` distinct bundles for two hosts,
  `clear` one, and assert the other host's access token is unchanged.
- **NFR-005-AC-2**: A unit test SHALL assert the access/refresh `SecretId`s for
  two different hosts differ (no shared key).
- **NFR-005-AC-3**: A unit test SHALL assert `fetchServiceDiscovery` rejects a
  plain-`http` non-`dev.ix` host with `DiscoveryInsecureError` and makes **no**
  `fetch` call, while accepting `http://*.dev.ix` and `insecure: true`.

## Verification

- Host-isolation ACs are covered by `auth-token-store.test.ts`.
- TLS-policy ACs are covered by `auth-discovery.test.ts` (host-normalization +
  the no-fetch-on-refusal assertion).
