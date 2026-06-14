import { describe, expect, it, vi } from "vitest";

import {
  hostSlug,
  MemoryBackend,
  MemoryTokenMetaStore,
  NotAuthenticatedError,
  SecretsService,
  TokenRefreshError,
  TokenStore,
  type AgentixServiceDiscovery,
  type SecretsBackend,
  type TokenBundle,
} from "../src/index.js";

const DISCOVERY: AgentixServiceDiscovery = {
  schema_version: "1",
  service: { name: "filament", display_name: "Filament" },
  issuer: "https://auth.dev.ix",
  audience: "filament",
  scopes_supported: ["openid", "filament:read"],
  device_authorization_endpoint:
    "https://filament.dev.ix/api/auth/device/authorize",
  device_token_endpoint: "https://filament.dev.ix/api/auth/device/token",
  device_request_endpoint: "https://filament.dev.ix/api/auth/device/request",
  approval_uri: "https://filament.dev.ix/login/device",
  token_refresh_endpoint: "https://auth.dev.ix/refresh",
};

function memorySecrets(): { svc: SecretsService; backend: MemoryBackend } {
  const backend = new MemoryBackend("memory");
  const svc = new SecretsService({
    mode: "memory",
    backends: new Map<string, SecretsBackend>([["memory", backend]]),
  });
  return { svc, backend };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("hostSlug", () => {
  it("slugifies a dotted host into a SecretId-name-safe segment", () => {
    expect(hostSlug("filament.dev.ix")).toBe("filament-dev-ix");
    expect(hostSlug("https://filament.dev.ix:8443/path")).toBe(
      "filament-dev-ix-8443",
    );
    expect(/^[a-z][a-z0-9-]*$/.test(hostSlug("9-leading.ix"))).toBe(true);
  });
});

describe("TokenStore — host isolation", () => {
  it("keys secrets per host so logins don't collide", async () => {
    const { svc } = memorySecrets();
    const store = new TokenStore({
      secrets: svc,
      meta: new MemoryTokenMetaStore(),
    });
    const now = 1_000_000;

    const fil: TokenBundle = {
      accessToken: "fil-at",
      refreshToken: "fil-rt",
      expiresAt: now + 3600_000,
      audience: "filament",
    };
    const other: TokenBundle = {
      accessToken: "other-at",
      refreshToken: "other-rt",
      expiresAt: now + 3600_000,
      audience: "other",
    };

    await store.save("filament.dev.ix", fil);
    await store.save("other.dev.ix", other);

    expect(await store.peekAccessToken("filament.dev.ix")).toBe("fil-at");
    expect(await store.peekAccessToken("other.dev.ix")).toBe("other-at");

    await store.clear("filament.dev.ix");
    expect(await store.peekAccessToken("filament.dev.ix")).toBeNull();
    // The other host is untouched.
    expect(await store.peekAccessToken("other.dev.ix")).toBe("other-at");
  });

  it("stores metadata (expiry/audience) separately from the secret", async () => {
    const { svc, backend } = memorySecrets();
    const meta = new MemoryTokenMetaStore();
    const store = new TokenStore({ secrets: svc, meta });
    await store.save("filament.dev.ix", {
      accessToken: "secret-value",
      refreshToken: "rt",
      expiresAt: 42,
      audience: "filament",
      scope: "openid",
    });
    const m = store.peekMeta("filament.dev.ix");
    expect(m).toEqual({ expiresAt: 42, audience: "filament", scope: "openid" });
    // The plaintext token is not present in the metadata store at all.
    expect(JSON.stringify(meta)).not.toContain("secret-value");
    // The token lives only under the host-keyed access secret.
    const stored = await backend.get(
      `core.auth-access-token-${hostSlug("filament.dev.ix")}` as `${string}.${string}`,
    );
    expect(stored).toBe("secret-value");
  });
});

describe("TokenStore.getAccessToken", () => {
  it("returns the stored token when it is fresh (no refresh, no fetch)", async () => {
    const { svc } = memorySecrets();
    const now = 1_000_000;
    const fetchImpl = vi.fn();
    const store = new TokenStore({
      secrets: svc,
      now: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await store.save("filament.dev.ix", {
      accessToken: "fresh-at",
      refreshToken: "rt",
      expiresAt: now + 60 * 60 * 1000,
      audience: "filament",
    });
    expect(await store.getAccessToken("filament.dev.ix")).toBe("fresh-at");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes before expiry and rotates the stored refresh token", async () => {
    const { svc } = memorySecrets();
    const now = 1_000_000;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(DISCOVERY.token_refresh_endpoint);
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      expect(String(init?.body)).toContain("refresh_token=rt-old");
      return json({
        access_token: "at-new",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-new",
      });
    });
    const store = new TokenStore({
      secrets: svc,
      now: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // Stored token expires within the 5-minute skew window.
    await store.save("filament.dev.ix", {
      accessToken: "at-old",
      refreshToken: "rt-old",
      expiresAt: now + 60 * 1000,
      audience: "filament",
    });

    const at = await store.getAccessToken("filament.dev.ix", {
      discovery: DISCOVERY,
    });
    expect(at).toBe("at-new");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Rotated refresh token is persisted.
    expect(await store.peekAccessToken("filament.dev.ix")).toBe("at-new");
    expect(store.peekMeta("filament.dev.ix")?.expiresAt).toBe(
      now + 3600 * 1000,
    );
  });

  it("keeps the old refresh token when the issuer doesn't rotate", async () => {
    const { svc, backend } = memorySecrets();
    const now = 1_000_000;
    const fetchImpl = vi.fn(async () =>
      json({ access_token: "at-new", token_type: "Bearer", expires_in: 3600 }),
    );
    const store = new TokenStore({
      secrets: svc,
      now: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await store.save("filament.dev.ix", {
      accessToken: "at-old",
      refreshToken: "rt-keep",
      expiresAt: now + 1000,
    });
    await store.getAccessToken("filament.dev.ix", { discovery: DISCOVERY });
    const rt = await backend.get(
      `core.auth-refresh-token-${hostSlug("filament.dev.ix")}` as `${string}.${string}`,
    );
    expect(rt).toBe("rt-keep");
  });

  it("throws NotAuthenticatedError when nothing is stored", async () => {
    const { svc } = memorySecrets();
    const store = new TokenStore({ secrets: svc });
    await expect(
      store.getAccessToken("filament.dev.ix"),
    ).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it("surfaces a refresh failure as TokenRefreshError", async () => {
    const { svc } = memorySecrets();
    const now = 1_000_000;
    const fetchImpl = vi.fn(async () => json({ error: "invalid_grant" }, 400));
    const store = new TokenStore({
      secrets: svc,
      now: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await store.save("filament.dev.ix", {
      accessToken: "at-old",
      refreshToken: "rt-old",
      expiresAt: now + 1000,
    });
    await expect(
      store.getAccessToken("filament.dev.ix", { discovery: DISCOVERY }),
    ).rejects.toBeInstanceOf(TokenRefreshError);
  });

  it("returns a near-expiry token without a refresh token rather than failing", async () => {
    const { svc } = memorySecrets();
    const now = 1_000_000;
    const store = new TokenStore({ secrets: svc, now: () => now });
    await store.save("filament.dev.ix", {
      accessToken: "at-only",
      expiresAt: now + 1000, // near expiry, no refresh token
    });
    expect(await store.getAccessToken("filament.dev.ix")).toBe("at-only");
  });
});
