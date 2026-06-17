---
id: FR-015
title: "Service Discovery Client"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-016"
    type: "required-by"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/non-functional/NFR-005"
    type: "requires"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-core` SHALL export a generic, service-agnostic service-discovery
client used to bootstrap the device-login flow ([FR-016](./FR-016-device-flow-runner.md)). The client is
parameterized entirely by a user-supplied `host`; no service identity is baked
into the framework.

```typescript
function fetchServiceDiscovery(
  host: string,
  opts?: {
    insecure?: boolean;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<AgentixServiceDiscovery>;

function normalizeHostOrigin(host: string, insecure?: boolean): string;
```

**Host normalization.** `normalizeHostOrigin` SHALL accept a bare host
(`filament.dev.ix`), a host with an explicit scheme
(`https://filament.dev.ix`), and a host carrying a path or port. It SHALL assume
`https` when no scheme is given, preserve an explicit port, and drop any path
(returning only the origin).

**TLS policy.** Plain `http` origins SHALL be refused with
`DiscoveryInsecureError` **unless** the host is `dev.ix` or a `*.dev.ix`
development host, or the caller passes `insecure: true` (the consuming CLI's
`--insecure` flag). This realizes [NFR-005](../non-functional/NFR-005-auth-host-isolation-tls.md).

**Document fetch + validation.** The client SHALL `GET`
`<origin>/.well-known/agentix-service.json` with `Accept: application/json`,
honoring `timeoutMs` (default 15000). It SHALL reject:

- a non-2xx response or transport failure with `DiscoveryFetchError`;
- a response body that is not valid JSON with `DiscoveryFetchError`;
- a document missing any required field with `DiscoverySchemaError` that names
  the missing field(s).

**Discovery shape.** The validated `AgentixServiceDiscovery` mirrors the
`gateway-bff-contract` model and SHALL carry at least: `schema_version`,
`service.name`, `issuer`, `audience`, `scopes_supported`,
`device_authorization_endpoint`, `device_token_endpoint`,
`device_request_endpoint`, `approval_uri`, `token_refresh_endpoint`. Unknown
extra fields SHALL be tolerated (forward-compatible).

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-015-AC-1 | `normalizeHostOrigin("filament.dev.ix")` returns `"https://filament.dev.ix"`; a host with a path (`https://filament.dev.ix/login/device`) returns the same origin with the path stripped. | Test |
| FR-015-AC-2 | `normalizeHostOrigin("filament.dev.ix:8443")` preserves the port → `"https://filament.dev.ix:8443"`. | Test |
| FR-015-AC-3 | `http://example.com` is rejected with `DiscoveryInsecureError`; the same host with `insecure: true`, and any `http://*.dev.ix` host, are accepted. | Test |
| FR-015-AC-4 | `fetchServiceDiscovery(host)` issues a `GET` to `<origin>/.well-known/agentix-service.json` and returns the parsed document on a 2xx JSON response. | Test |
| FR-015-AC-5 | A non-2xx status or transport error raises `DiscoveryFetchError`. | Test |
| FR-015-AC-6 | A document missing a required field (e.g. `audience`) raises `DiscoverySchemaError` whose `missing` list names the offending field. | Test |
| FR-015-AC-7 | A plain-`http` non-`dev.ix` host without `insecure` raises `DiscoveryInsecureError` **before** any network request is made. | Test |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [NFR-005](../non-functional/NFR-005-auth-host-isolation-tls.md) (requires)
- **Downstream**: [FR-016](./FR-016-device-flow-runner.md) (required-by)

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (`src/auth/`).
The only outbound call is the `GET /.well-known/agentix-service.json` request;
no service-specific URL is embedded in the library.

| Symbol                  | Signature                                                                                 | Returns                             | Description                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `fetchServiceDiscovery` | `(host: string, opts?: FetchServiceDiscoveryOptions) => Promise<AgentixServiceDiscovery>` | discovery doc                       | Normalizes host → fetches well-known → validates required fields. Throws the discovery errors above.    |
| `normalizeHostOrigin`   | `(host: string, insecure?: boolean) => string`                                            | origin                              | Pure host→origin normalization with TLS policy. Throws `DiscoveryHostError` / `DiscoveryInsecureError`. |
| `WELL_KNOWN_PATH`       | `string`                                                                                  | `/.well-known/agentix-service.json` | The discovery path constant.                                                                            |
