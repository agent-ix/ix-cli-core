import type { SecretsService } from "../secrets/service.js";
import type { SecretId } from "../secrets/types.js";
import {
  fetchServiceDiscovery,
  type FetchServiceDiscoveryOptions,
} from "./discovery.js";
import type {
  AgentixServiceDiscovery,
  DeviceTokenResponse,
  TokenBundle,
  TokenMeta,
} from "./types.js";

/**
 * Host-keyed, audience-scoped token store.
 *
 * Tokens are persisted via the framework `SecretsService` so they never land
 * in plaintext on disk (OS keyring or age-encrypted fallback). Non-sensitive
 * metadata (`expiresAt` / `audience` / `scope`) is persisted through an
 * injectable {@link TokenMetaStore} — the host CLI backs this with its own
 * config plugin (e.g. the IX `core` plugin). Each `host` gets its own pair of
 * secrets and its own metadata entry, so logging into one service never
 * disturbs another (host isolation).
 *
 * Secret id layout (one `.` per the SecretId regex — the host is slugified
 * into the secret-name segment):
 *
 *   `<plugin>.auth-access-token-<host-slug>`
 *   `<plugin>.auth-refresh-token-<host-slug>`
 */

/** Default plugin namespace for token secrets/metadata. */
export const DEFAULT_TOKEN_PLUGIN_ID = "core";

/** Refresh the access token when it is within this window of expiry. */
export const DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/** Raised when no token is stored for a host and a refresh isn't possible. */
export class NotAuthenticatedError extends Error {
  readonly host: string;
  constructor(host: string, hint = "run `login` first") {
    super(`not authenticated for ${host} — ${hint}`);
    this.name = "NotAuthenticatedError";
    this.host = host;
  }
}

/** Raised when a token refresh attempt fails. */
export class TokenRefreshError extends Error {
  readonly host: string;
  readonly status?: number;
  constructor(host: string, detail: string, status?: number) {
    super(`token refresh failed for ${host}: ${detail}`);
    this.name = "TokenRefreshError";
    this.host = host;
    this.status = status;
  }
}

/**
 * Pluggable metadata store for non-sensitive token metadata. The host CLI
 * implements this against its own config plugin. Metadata is keyed by the
 * slugified host so multiple services can coexist.
 */
export interface TokenMetaStore {
  read(hostSlug: string): TokenMeta | undefined;
  write(hostSlug: string, meta: TokenMeta): void;
  clear(hostSlug: string): void;
}

/** In-memory metadata store — used by tests and as a reference adapter. */
export class MemoryTokenMetaStore implements TokenMetaStore {
  private readonly store = new Map<string, TokenMeta>();
  read(hostSlug: string): TokenMeta | undefined {
    return this.store.get(hostSlug);
  }
  write(hostSlug: string, meta: TokenMeta): void {
    this.store.set(hostSlug, meta);
  }
  clear(hostSlug: string): void {
    this.store.delete(hostSlug);
  }
}

export interface TokenStoreOptions {
  secrets: SecretsService;
  /** Metadata store. Defaults to an in-process {@link MemoryTokenMetaStore}. */
  meta?: TokenMetaStore;
  /** Plugin namespace for secret ids. Default `"core"`. */
  pluginId?: string;
  /** Injectable fetch for refresh + discovery; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
  /** Refresh-before-expiry window in ms. Default 5 minutes. */
  refreshSkewMs?: number;
}

export interface GetAccessTokenOptions {
  /** Force a refresh even when the stored token is not near expiry. */
  forceRefresh?: boolean;
  /** Discovery doc, when already fetched (avoids a second network round-trip). */
  discovery?: AgentixServiceDiscovery;
  /** Options forwarded to `fetchServiceDiscovery` when discovery is absent. */
  discoveryOptions?: FetchServiceDiscoveryOptions;
}

/**
 * Deterministic 32-bit FNV-1a hash of `s`, rendered as zero-padded base36.
 *
 * Used to disambiguate host slugs: two authorities that collapse to the same
 * readable slug (e.g. `foo.bar.dev.ix` and `foo-bar.dev.ix`, which both lose
 * their separator distinction) still get distinct suffixes because the hash is
 * taken over the full, un-collapsed authority. No crypto strength is needed —
 * this is a collision-avoidance discriminator, not a security primitive.
 */
function hostHashSuffix(authority: string): string {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < authority.length; i += 1) {
    h ^= authority.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit unsigned range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

/**
 * Slugify a host into a SecretId-name-safe segment.
 *
 * `[a-z][a-z0-9-]*` — lowercases, drops any scheme, keeps the `host[:port]`
 * authority, replaces any run of non-alphanumerics with a single `-`, and
 * appends a short hash of the *full authority* so the mapping is injective:
 * distinct hosts NEVER share a slug (host isolation, NFR-005-AC-2). Without
 * the hash, `foo.bar.dev.ix` and `foo-bar.dev.ix` would both collapse to
 * `foo-bar-dev-ix` and bleed one host's tokens into the other.
 */
export function hostSlug(host: string): string {
  const lowered = (host ?? "").trim().toLowerCase();
  // Drop a scheme if present, keep only the host[:port] authority.
  const withoutScheme = lowered.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const authority = withoutScheme.split("/")[0];
  let slug = authority.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length === 0) slug = "host";
  if (!/^[a-z]/.test(slug)) slug = `h-${slug}`;
  // Append a discriminator derived from the full authority so two authorities
  // that collapse to the same readable slug still map to distinct ids.
  return `${slug}-${hostHashSuffix(authority)}`;
}

export class TokenStore {
  private readonly secrets: SecretsService;
  private readonly meta: TokenMetaStore;
  private readonly pluginId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;

  constructor(opts: TokenStoreOptions) {
    this.secrets = opts.secrets;
    this.meta = opts.meta ?? new MemoryTokenMetaStore();
    this.pluginId = opts.pluginId ?? DEFAULT_TOKEN_PLUGIN_ID;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.refreshSkewMs = opts.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  }

  private accessIdForSlug(slug: string): SecretId {
    return `${this.pluginId}.auth-access-token-${slug}` as SecretId;
  }

  private refreshIdForSlug(slug: string): SecretId {
    return `${this.pluginId}.auth-refresh-token-${slug}` as SecretId;
  }

  private accessId(host: string): SecretId {
    return this.accessIdForSlug(hostSlug(host));
  }

  private refreshId(host: string): SecretId {
    return this.refreshIdForSlug(hostSlug(host));
  }

  /** Persist a freshly-obtained bundle for `host`. */
  async save(host: string, bundle: TokenBundle): Promise<void> {
    await this.secrets.set(this.accessId(host), bundle.accessToken);
    if (bundle.refreshToken) {
      await this.secrets.set(this.refreshId(host), bundle.refreshToken);
    } else {
      await this.secrets.delete(this.refreshId(host));
    }
    this.meta.write(hostSlug(host), {
      expiresAt: bundle.expiresAt,
      audience: bundle.audience,
      scope: bundle.scope,
      host,
    });
  }

  /** Forget all stored material for `host`. Idempotent. */
  async clear(host: string): Promise<void> {
    await this.clearBySlug(hostSlug(host));
  }

  /**
   * Forget all stored material for an already-slugified key. Used when
   * enumerating stored entries (the `TokenMetaStore` is keyed by slug, so its
   * keys are slugs, not raw hosts — re-slugifying a slug would double-hash it
   * and miss the entry). Idempotent.
   */
  async clearBySlug(slug: string): Promise<void> {
    await this.secrets.delete(this.accessIdForSlug(slug));
    await this.secrets.delete(this.refreshIdForSlug(slug));
    this.meta.clear(slug);
  }

  /** Stored metadata for `host`, or `undefined` if not logged in. */
  peekMeta(host: string): TokenMeta | undefined {
    return this.meta.read(hostSlug(host));
  }

  /**
   * Stored metadata for an already-slugified key, or `undefined`. Counterpart
   * to {@link clearBySlug} for enumerating stored entries by their slug key.
   */
  peekMetaBySlug(slug: string): TokenMeta | undefined {
    return this.meta.read(slug);
  }

  /** Raw stored access token (no refresh). `null` when absent. */
  async peekAccessToken(host: string): Promise<string | null> {
    return this.secrets.get(this.accessId(host));
  }

  /**
   * Resolve a usable access token for `host`, refreshing before expiry and
   * rotating the stored refresh token when the issuer returns a new one.
   *
   * - Returns the stored access token when it is present and not within the
   *   refresh-skew window of expiry.
   * - Otherwise, when a refresh token is stored, calls the discovery doc's
   *   `token_refresh_endpoint`, persists the rotated bundle, and returns the
   *   new access token.
   * - Throws {@link NotAuthenticatedError} when no usable material exists.
   */
  async getAccessToken(
    host: string,
    opts: GetAccessTokenOptions = {},
  ): Promise<string> {
    const meta = this.meta.read(hostSlug(host));
    const access = await this.secrets.get(this.accessId(host));

    const fresh =
      access !== null &&
      meta !== undefined &&
      meta.expiresAt - this.now() > this.refreshSkewMs;

    if (fresh && !opts.forceRefresh) {
      return access as string;
    }

    const refreshToken = await this.secrets.get(this.refreshId(host));
    if (!refreshToken) {
      if (access !== null && !opts.forceRefresh) {
        // No refresh token, but a (possibly soon-to-expire) access token is
        // present — return it rather than failing. The caller retries login
        // on a 401.
        return access;
      }
      throw new NotAuthenticatedError(host);
    }

    const discovery =
      opts.discovery ??
      (await fetchServiceDiscovery(host, opts.discoveryOptions));
    const bundle = await this.refresh(host, discovery, refreshToken);
    await this.save(host, bundle);
    return bundle.accessToken;
  }

  /**
   * Exchange a refresh token at the discovery doc's refresh endpoint. The
   * returned bundle carries the rotated refresh token when the issuer
   * provides one; otherwise the existing refresh token is preserved.
   */
  private async refresh(
    host: string,
    discovery: AgentixServiceDiscovery,
    refreshToken: string,
  ): Promise<TokenBundle> {
    let res: Response;
    try {
      res = await this.fetchImpl(discovery.token_refresh_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      });
    } catch (err) {
      throw new TokenRefreshError(
        host,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (!res.ok) {
      throw new TokenRefreshError(
        host,
        `HTTP ${res.status} ${res.statusText}`,
        res.status,
      );
    }
    let body: DeviceTokenResponse;
    try {
      body = (await res.json()) as DeviceTokenResponse;
    } catch (err) {
      throw new TokenRefreshError(
        host,
        `response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (
      typeof body.access_token !== "string" ||
      body.access_token.length === 0
    ) {
      throw new TokenRefreshError(host, "refresh response had no access_token");
    }
    const meta = this.meta.read(hostSlug(host));
    return {
      accessToken: body.access_token,
      // Rotate when the issuer returns a new refresh token; else keep the old.
      refreshToken: body.refresh_token ?? refreshToken,
      expiresAt: this.now() + Math.max(0, body.expires_in ?? 0) * 1000,
      audience: discovery.audience ?? meta?.audience,
      scope: body.scope ?? meta?.scope,
    };
  }
}
