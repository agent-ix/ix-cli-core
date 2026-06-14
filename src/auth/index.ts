/**
 * Generic, service-agnostic CLI auth engine for `@agent-ix/ix-cli-core`.
 *
 * The engine implements the OAuth 2.0 Device Authorization Grant (RFC 8628)
 * against any service that serves a `/.well-known/agentix-service.json`
 * discovery document. Every endpoint, audience, and scope is parameterized by
 * the discovery doc — no service identity (Filament, etc.) is baked in. The
 * consuming CLI supplies its own defaults (client id, host) and UI presenter.
 *
 * Public surface:
 *   - `fetchServiceDiscovery(host)` — discovery client.
 *   - `runDeviceFlow(discovery)`   — authorize → present → poll runner.
 *   - `TokenStore`                 — host-keyed, audience-scoped token store
 *     with `getAccessToken({host})` refresh-before-expiry + rotation.
 *   - `openBrowser(url)`           — non-fatal opener.
 */

export {
  fetchServiceDiscovery,
  normalizeHostOrigin,
  WELL_KNOWN_PATH,
  DiscoveryHostError,
  DiscoveryInsecureError,
  DiscoveryFetchError,
  DiscoverySchemaError,
  type FetchServiceDiscoveryOptions,
} from "./discovery.js";

export {
  runDeviceFlow,
  DeviceFlowError,
  DEFAULT_DEVICE_CLIENT_ID,
  type DeviceFlowErrorCode,
  type DeviceFlowPrompter,
  type RunDeviceFlowOptions,
} from "./device-flow.js";

export { DEVICE_CODE_GRANT_TYPE } from "./types.js";

export {
  TokenStore,
  MemoryTokenMetaStore,
  NotAuthenticatedError,
  TokenRefreshError,
  hostSlug,
  DEFAULT_TOKEN_PLUGIN_ID,
  DEFAULT_REFRESH_SKEW_MS,
  type TokenMetaStore,
  type TokenStoreOptions,
  type GetAccessTokenOptions,
} from "./token-store.js";

export { openBrowser } from "./browser-open.js";

export type {
  AgentixServiceDiscovery,
  ServiceIdentity,
  DeviceAuthorizeRequest,
  DeviceAuthorizeResponse,
  DeviceTokenRequest,
  DeviceTokenResponse,
  DeviceTokenError,
  TokenBundle,
  TokenMeta,
} from "./types.js";
