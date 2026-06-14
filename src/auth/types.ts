/**
 * Generic, service-agnostic auth engine types for `@agent-ix/ix-cli-core`.
 *
 * These shapes mirror the `gateway-bff-contract` (Python/pydantic) models so
 * the CLI validates against the same contract the BFF (server) and the browser
 * SDK (`ts-auth-sdk`) use. The contract is the OAuth 2.0 Device Authorization
 * Grant (RFC 8628) proxied by each product BFF, plus the
 * `/.well-known/agentix-service.json` discovery document.
 *
 * Inbound shapes are intentionally permissive on unknown extra fields so the
 * contract is forward-compatible: a newer producer may add fields without
 * breaking an older consumer. Only the fields the engine needs are typed; the
 * rest are tolerated and ignored.
 */

/** RFC 8628 device-code grant type value. */
export const DEVICE_CODE_GRANT_TYPE =
  "urn:ietf:params:oauth:grant-type:device_code";

/** Service identity nested in {@link AgentixServiceDiscovery}. */
export interface ServiceIdentity {
  name: string;
  display_name: string;
  logo_uri?: string;
}

/**
 * The `/.well-known/agentix-service.json` document served by every product BFF
 * (via the gateway). Consumed by the CLI to drive the device flow. Realizes
 * the `auth` umbrella's ADR-011 service-discovery contract.
 */
export interface AgentixServiceDiscovery {
  schema_version: string;
  service: ServiceIdentity;
  issuer: string;
  audience: string;
  scopes_supported: string[];
  device_authorization_endpoint: string;
  device_token_endpoint: string;
  device_request_endpoint: string;
  approval_uri: string;
  token_refresh_endpoint: string;
}

/** CLI -> BFF `POST /api/auth/device/authorize` request body. */
export interface DeviceAuthorizeRequest {
  client_id: string;
  audience?: string;
  scope?: string;
}

/**
 * BFF -> CLI authorize response. `expires_in` is bounded `<= 300` per the
 * `auth` umbrella's NFR; enforcement is the issuer's responsibility.
 */
export interface DeviceAuthorizeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  verification_uri_complete?: string;
}

/** CLI -> BFF `POST /api/auth/device/token` poll request body. */
export interface DeviceTokenRequest {
  grant_type: string;
  device_code: string;
  client_id: string;
}

/** BFF -> CLI token bundle returned once the request is approved. */
export interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * RFC 8628 OAuth error body returned by `device/token` while polling.
 * The CLI poller branches on the `error` code:
 * `authorization_pending`, `slow_down`, `access_denied`, `expired_token`,
 * `invalid_grant`.
 */
export interface DeviceTokenError {
  error: string;
  error_description?: string;
}

/**
 * The normalized, host-keyed token bundle the engine persists. The
 * `access_token` and `refresh_token` go into the SecretsService backend; the
 * `expiresAt`/`audience`/`scope` metadata go into config (never plaintext
 * tokens on disk).
 */
export interface TokenBundle {
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch milliseconds at which `accessToken` expires. */
  expiresAt: number;
  /** Token audience (service id), e.g. `"filament"`. */
  audience?: string;
  /** Space-delimited granted scopes, when the issuer reports them. */
  scope?: string;
}

/**
 * Non-sensitive metadata stored in config alongside the host-keyed secrets:
 * everything except the tokens themselves. Persisting this lets the engine
 * decide whether to refresh-before-expiry without first touching the keyring.
 */
export interface TokenMeta {
  /** Unix epoch milliseconds at which the stored access token expires. */
  expiresAt: number;
  audience?: string;
  scope?: string;
  /**
   * The original (normalized) host this entry was saved for, e.g.
   * `"filament.dev.ix"`. Persisted so `whoami` / `logout` can display a
   * human-readable host rather than the hash-discriminated storage slug. Not
   * sensitive (it is the public service host, never a token).
   */
  host?: string;
}
