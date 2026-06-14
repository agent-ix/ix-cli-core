import { describe, expect, it, vi } from "vitest";

import {
  DiscoveryFetchError,
  DiscoveryHostError,
  DiscoveryInsecureError,
  DiscoverySchemaError,
  fetchServiceDiscovery,
  normalizeHostOrigin,
  WELL_KNOWN_PATH,
  type AgentixServiceDiscovery,
} from "../src/index.js";

const VALID_DOC: AgentixServiceDiscovery = {
  schema_version: "1",
  service: {
    name: "filament",
    display_name: "Filament",
    logo_uri: "https://filament.dev.ix/logo.svg",
  },
  issuer: "https://auth.dev.ix",
  audience: "filament",
  scopes_supported: ["openid", "profile", "filament:read", "filament:write"],
  device_authorization_endpoint:
    "https://filament.dev.ix/api/auth/device/authorize",
  device_token_endpoint: "https://filament.dev.ix/api/auth/device/token",
  device_request_endpoint: "https://filament.dev.ix/api/auth/device/request",
  approval_uri: "https://filament.dev.ix/login/device",
  token_refresh_endpoint: "https://auth.dev.ix/refresh",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("normalizeHostOrigin", () => {
  it("assumes https for a bare host and drops any path", () => {
    expect(normalizeHostOrigin("filament.dev.ix")).toBe(
      "https://filament.dev.ix",
    );
    expect(normalizeHostOrigin("https://filament.dev.ix/login/device")).toBe(
      "https://filament.dev.ix",
    );
  });

  it("preserves an explicit port", () => {
    expect(normalizeHostOrigin("filament.dev.ix:8443")).toBe(
      "https://filament.dev.ix:8443",
    );
  });

  it("allows http for *.dev.ix hosts", () => {
    expect(normalizeHostOrigin("http://filament.dev.ix")).toBe(
      "http://filament.dev.ix",
    );
  });

  it("rejects http for non-dev.ix hosts unless insecure", () => {
    expect(() => normalizeHostOrigin("http://example.com")).toThrow(
      DiscoveryInsecureError,
    );
    expect(normalizeHostOrigin("http://example.com", true)).toBe(
      "http://example.com",
    );
  });

  it("rejects empty and non-http schemes", () => {
    expect(() => normalizeHostOrigin("")).toThrow(DiscoveryHostError);
    expect(() => normalizeHostOrigin("ftp://x.dev.ix")).toThrow(
      DiscoveryHostError,
    );
  });
});

describe("fetchServiceDiscovery", () => {
  it("GETs the well-known path and returns the parsed doc", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(VALID_DOC));
    const doc = await fetchServiceDiscovery("filament.dev.ix", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(doc.audience).toBe("filament");
    expect(doc.service.name).toBe("filament");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = (fetchImpl.mock.calls[0] as unknown[])[0] as string;
    expect(url).toBe(`https://filament.dev.ix${WELL_KNOWN_PATH}`);
  });

  it("raises DiscoveryFetchError on a non-2xx status", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { status: 404, statusText: "Not Found" }),
    );
    await expect(
      fetchServiceDiscovery("filament.dev.ix", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(DiscoveryFetchError);
  });

  it("raises DiscoveryFetchError on a transport error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      fetchServiceDiscovery("filament.dev.ix", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(DiscoveryFetchError);
  });

  it("raises DiscoverySchemaError naming missing fields", async () => {
    const { audience: _drop, ...partial } = VALID_DOC;
    void _drop;
    const fetchImpl = vi.fn(async () => jsonResponse(partial));
    let err: unknown;
    try {
      await fetchServiceDiscovery("filament.dev.ix", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DiscoverySchemaError);
    expect((err as DiscoverySchemaError).missing).toContain("audience");
  });

  it("refuses plain http for non-dev.ix without insecure (no fetch)", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchServiceDiscovery("http://example.com", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(DiscoveryInsecureError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
