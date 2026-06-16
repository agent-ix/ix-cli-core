---
id: FR-016
title: "Device-Flow Runner"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-015"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-017"
    type: "required-by"
    cardinality: "1:1"
---

## Behavior

`@agent-ix/ix-cli-core` SHALL export a generic OAuth 2.0 Device Authorization
Grant (RFC 8628) runner that drives a login against the endpoints in a
`AgentixServiceDiscovery` document (FR-015):

```typescript
function runDeviceFlow(
  discovery: AgentixServiceDiscovery,
  opts?: RunDeviceFlowOptions,
): Promise<TokenBundle>;
```

The runner is **service-agnostic**: every endpoint comes from `discovery`, and
the audience/scope default to `discovery.audience` / `discovery.scopes_supported`
but may be overridden. The default `client_id` is the generic `"ix-cli"`; the
consuming CLI supplies its own.

**Sequence.**

1. **Authorize.** `POST` `device_authorization_endpoint` (form-encoded:
   `client_id`, `audience`, `scope`). A non-2xx response, or a body missing
   `device_code` / `user_code` / `verification_uri`, raises `DeviceFlowError`
   with code `authorize_failed`.
2. **Present.** The runner SHALL surface the `verification_uri` and `user_code`
   prominently through the injected `prompter` (the host CLI owns rendering —
   the engine never writes to stdout directly), including
   `verification_uri_complete` when present.
3. **Browser open (best-effort, non-fatal).** Unless `openBrowser === false`,
   the runner SHALL attempt to open `verification_uri_complete ??
verification_uri` via the framework opener (FR-018). Any failure SHALL be
   swallowed; it MUST NOT abort the flow.
4. **Poll.** The runner SHALL `POST` `device_token_endpoint` (form-encoded:
   `grant_type` = the RFC 8628 device-code value, `device_code`, `client_id`)
   on each tick, waiting `interval` seconds between polls. It SHALL branch on
   the response:
   - **2xx with `access_token`** → return a normalized `TokenBundle`
     (`accessToken`, `refreshToken?`, `expiresAt` = now + `expires_in`,
     `audience`, `scope`).
   - **`authorization_pending`** (or HTTP `428` with no recognized error) →
     keep polling at the current interval.
   - **`slow_down`** → increase the poll interval by 5 seconds and continue.
   - **`access_denied`** → raise `DeviceFlowError` code `access_denied`.
   - **`expired_token`**, or the `expires_in` deadline elapsing before
     approval → raise `DeviceFlowError` code `expired_token`.
   - any other non-2xx with an unrecognized error → raise `DeviceFlowError`
     code `token_failed`.

**Injection.** `fetchImpl`, `sleepImpl`, `openBrowserImpl`, and `now` SHALL be
injectable so the runner's state machine is unit-testable without real time,
network, or a browser. An `AbortSignal` MAY cancel polling.

## Acceptance

- **FR-016-AC-1**: With a mocked fetch returning `authorization_pending` then a
  token, `runDeviceFlow` returns a `TokenBundle` whose `accessToken`,
  `refreshToken`, `audience`, and `expiresAt` (= injected-now + `expires_in`·1000)
  match the token response.
- **FR-016-AC-2**: The authorize request body carries `client_id`, and the
  `audience`/`scope` derived from `discovery`.
- **FR-016-AC-3**: The injected `prompter.showVerification` is called exactly
  once with the `verificationUri` and `userCode` from the authorize response.
- **FR-016-AC-4**: A `slow_down` response increases the subsequent poll
  interval by exactly 5000 ms.
- **FR-016-AC-5**: An `access_denied` response raises `DeviceFlowError` with
  code `access_denied`; an `expired_token` response, and the `expires_in`
  deadline elapsing, both raise code `expired_token`.
- **FR-016-AC-6**: A non-2xx authorize response raises `DeviceFlowError` code
  `authorize_failed` and no polling occurs.
- **FR-016-AC-7**: A browser-open implementation that throws does NOT abort the
  flow; the runner still returns a token.
- **FR-016-AC-8**: When `verification_uri_complete` is present, it is the URL
  passed to the browser opener.

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (`src/auth/`).
Outbound calls target only the `device_authorization_endpoint` and
`device_token_endpoint` from the supplied discovery document.

| Symbol                     | Signature                                                                                   | Returns      | Description                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `runDeviceFlow`            | `(discovery: AgentixServiceDiscovery, opts?: RunDeviceFlowOptions) => Promise<TokenBundle>` | token bundle | Authorize → present → best-effort open → poll. Throws `DeviceFlowError`.             |
| `DeviceFlowError`          | `class extends Error { code: DeviceFlowErrorCode }`                                         | —            | `access_denied` / `expired_token` / `authorize_failed` / `token_failed` / `aborted`. |
| `DEFAULT_DEVICE_CLIENT_ID` | `string`                                                                                    | `"ix-cli"`   | Default OAuth client id when the caller doesn't supply one.                          |
