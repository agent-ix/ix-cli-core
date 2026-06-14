import { describe, expect, it, vi } from "vitest";

import {
  DeviceFlowError,
  runDeviceFlow,
  type AgentixServiceDiscovery,
  type DeviceFlowPrompter,
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const AUTHORIZE_OK = {
  device_code: "dev-123",
  user_code: "WXYZ-1234",
  verification_uri: "https://filament.dev.ix/login/device",
  expires_in: 300,
  interval: 5,
};

/** A fetch stub that returns authorize once, then walks a token-poll script. */
function makeFetch(pollScript: Response[]): {
  fetchImpl: typeof fetch;
  calls: { url: string; body: string }[];
} {
  const calls: { url: string; body: string }[] = [];
  let pollIndex = 0;
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/authorize")) return json(AUTHORIZE_OK);
    if (url.endsWith("/token")) {
      const res = pollScript[Math.min(pollIndex, pollScript.length - 1)];
      pollIndex += 1;
      return res;
    }
    throw new Error(`unexpected url ${url}`);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const noSleep = async (): Promise<void> => {};
const noOpen = async (): Promise<boolean> => false;

function recordingPrompter(): {
  prompter: DeviceFlowPrompter;
  shown: Parameters<DeviceFlowPrompter["showVerification"]>[0][];
} {
  const shown: Parameters<DeviceFlowPrompter["showVerification"]>[0][] = [];
  return {
    shown,
    prompter: {
      showVerification: (info) => {
        shown.push(info);
      },
    },
  };
}

describe("runDeviceFlow — happy path", () => {
  it("authorizes, presents, polls past pending, returns a token bundle", async () => {
    const { fetchImpl, calls } = makeFetch([
      json({ error: "authorization_pending" }, 428),
      json({
        access_token: "at-1",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-1",
        scope: "openid filament:read",
      }),
    ]);
    const { prompter, shown } = recordingPrompter();
    let t = 1_000_000;

    const bundle = await runDeviceFlow(DISCOVERY, {
      fetchImpl,
      sleepImpl: noSleep,
      openBrowserImpl: noOpen,
      prompter,
      now: () => t,
    });

    expect(bundle.accessToken).toBe("at-1");
    expect(bundle.refreshToken).toBe("rt-1");
    expect(bundle.audience).toBe("filament");
    expect(bundle.expiresAt).toBe(t + 3600 * 1000);

    // Prompt showed the BRANDED approval URI (approval_uri + user_code), the
    // raw verification URI, and the user code.
    expect(shown).toHaveLength(1);
    expect(shown[0].approvalUri).toBe(
      "https://filament.dev.ix/login/device?user_code=WXYZ-1234",
    );
    expect(shown[0].verificationUri).toBe(AUTHORIZE_OK.verification_uri);
    expect(shown[0].userCode).toBe(AUTHORIZE_OK.user_code);

    // authorize body is JSON (the BFF device routes are application/json) and
    // carried audience + scope from discovery.
    const authCall = calls.find((c) => c.url.endsWith("/authorize"));
    const authBody = JSON.parse(authCall?.body ?? "{}");
    expect(authBody.audience).toBe("filament");
    expect(authBody.client_id).toBe("ix-cli");
    expect(authBody.scope).toBe("openid filament:read");
  });

  it("sends JSON request bodies with Content-Type application/json", async () => {
    const headersSeen: (HeadersInit | undefined)[] = [];
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      headersSeen.push(init?.headers);
      bodies.push(String(init?.body ?? ""));
      if (url.endsWith("/authorize")) return json(AUTHORIZE_OK);
      return json({ access_token: "at", token_type: "Bearer", expires_in: 60 });
    });
    await runDeviceFlow(DISCOVERY, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
      openBrowserImpl: noOpen,
    });
    // Every POST declared JSON and carried a JSON-parseable body.
    for (const h of headersSeen) {
      expect((h as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    }
    for (const b of bodies) {
      expect(() => JSON.parse(b)).not.toThrow();
    }
    // token poll body is the device-code grant.
    const poll = JSON.parse(bodies[1]);
    expect(poll.grant_type).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
    expect(poll.device_code).toBe(AUTHORIZE_OK.device_code);
  });

  it("prefers the branded approval_uri (+ user_code) for browser open and prompt", async () => {
    // Even when the issuer supplies a verification_uri_complete, the discovery
    // document's approval_uri wins: the user is directed to the product's own
    // branded approval page, not the raw issuer verification URI.
    const { fetchImpl } = makeFetch([
      json({ access_token: "at", token_type: "Bearer", expires_in: 60 }),
    ]);
    const { prompter, shown } = recordingPrompter();
    const opened: string[] = [];
    await runDeviceFlow(
      { ...DISCOVERY },
      {
        fetchImpl: ((url: string, init?: RequestInit) => {
          if (url.endsWith("/authorize")) {
            return Promise.resolve(
              json({
                ...AUTHORIZE_OK,
                verification_uri: "https://auth.dev.ix/api/v1/device",
                verification_uri_complete:
                  "https://auth.dev.ix/api/v1/device?code=WXYZ-1234",
              }),
            );
          }
          return (fetchImpl as unknown as typeof fetch)(url, init);
        }) as unknown as typeof fetch,
        sleepImpl: noSleep,
        prompter,
        openBrowserImpl: async (u: string) => {
          opened.push(u);
          return true;
        },
      },
    );
    const branded = "https://filament.dev.ix/login/device?user_code=WXYZ-1234";
    expect(opened).toEqual([branded]);
    expect(shown[0].approvalUri).toBe(branded);
    // Raw issuer verification URI is still surfaced as a fallback/reference.
    expect(shown[0].verificationUri).toBe("https://auth.dev.ix/api/v1/device");
  });

  it("falls back to verification_uri_complete when discovery has no approval_uri", async () => {
    const { fetchImpl } = makeFetch([
      json({ access_token: "at", token_type: "Bearer", expires_in: 60 }),
    ]);
    const { prompter, shown } = recordingPrompter();
    const opened: string[] = [];
    const noApproval = {
      ...DISCOVERY,
      approval_uri: "",
    } as unknown as AgentixServiceDiscovery;
    await runDeviceFlow(noApproval, {
      fetchImpl: ((url: string, init?: RequestInit) => {
        if (url.endsWith("/authorize")) {
          return Promise.resolve(
            json({
              ...AUTHORIZE_OK,
              verification_uri_complete:
                "https://filament.dev.ix/login/device?user_code=WXYZ-1234",
            }),
          );
        }
        return (fetchImpl as unknown as typeof fetch)(url, init);
      }) as unknown as typeof fetch,
      sleepImpl: noSleep,
      prompter,
      openBrowserImpl: async (u: string) => {
        opened.push(u);
        return true;
      },
    });
    expect(opened).toEqual([
      "https://filament.dev.ix/login/device?user_code=WXYZ-1234",
    ]);
    expect(shown[0].approvalUri).toBe(
      "https://filament.dev.ix/login/device?user_code=WXYZ-1234",
    );
  });
});

describe("runDeviceFlow — polling state machine", () => {
  it("backs off on slow_down (interval grows by 5s)", async () => {
    const { fetchImpl } = makeFetch([
      json({ error: "slow_down" }, 400),
      json({ error: "authorization_pending" }, 428),
      json({ access_token: "at", token_type: "Bearer", expires_in: 60 }),
    ]);
    const sleeps: number[] = [];
    const bundle = await runDeviceFlow(DISCOVERY, {
      fetchImpl,
      sleepImpl: async (ms: number) => {
        sleeps.push(ms);
      },
      openBrowserImpl: noOpen,
    });
    expect(bundle.accessToken).toBe("at");
    // interval=5 → 5000; after one slow_down → 10000 for subsequent polls.
    expect(sleeps[0]).toBe(5000);
    expect(sleeps[1]).toBe(10000);
    expect(sleeps[2]).toBe(10000);
  });

  it("throws access_denied when the browser denies", async () => {
    const { fetchImpl } = makeFetch([json({ error: "access_denied" }, 403)]);
    let err: unknown;
    try {
      await runDeviceFlow(DISCOVERY, {
        fetchImpl,
        sleepImpl: noSleep,
        openBrowserImpl: noOpen,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DeviceFlowError);
    expect((err as DeviceFlowError).code).toBe("access_denied");
  });

  it("throws expired_token on the expired_token error code", async () => {
    const { fetchImpl } = makeFetch([json({ error: "expired_token" }, 400)]);
    await expect(
      runDeviceFlow(DISCOVERY, {
        fetchImpl,
        sleepImpl: noSleep,
        openBrowserImpl: noOpen,
      }),
    ).rejects.toMatchObject({ code: "expired_token" });
  });

  it("throws expired_token when the deadline passes before approval", async () => {
    const { fetchImpl } = makeFetch([
      json({ error: "authorization_pending" }, 428),
    ]);
    let t = 0;
    await expect(
      runDeviceFlow(
        { ...DISCOVERY },
        {
          fetchImpl: ((url: string, init?: RequestInit) => {
            if (url.endsWith("/authorize")) {
              return Promise.resolve(
                json({ ...AUTHORIZE_OK, expires_in: 10, interval: 5 }),
              );
            }
            return (fetchImpl as unknown as typeof fetch)(url, init);
          }) as unknown as typeof fetch,
          sleepImpl: async (ms: number) => {
            t += ms; // advance virtual clock past the 10s deadline
          },
          openBrowserImpl: noOpen,
          now: () => t,
        },
      ),
    ).rejects.toMatchObject({ code: "expired_token" });
  });

  it("fails authorize on a non-2xx authorize response", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/authorize"))
        return json({ error: "invalid_client" }, 401);
      throw new Error("should not poll");
    });
    await expect(
      runDeviceFlow(DISCOVERY, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: noSleep,
        openBrowserImpl: noOpen,
      }),
    ).rejects.toMatchObject({ code: "authorize_failed" });
  });

  it("browser-open failure is non-fatal", async () => {
    const { fetchImpl } = makeFetch([
      json({ access_token: "at", token_type: "Bearer", expires_in: 60 }),
    ]);
    const bundle = await runDeviceFlow(DISCOVERY, {
      fetchImpl,
      sleepImpl: noSleep,
      openBrowserImpl: async () => {
        throw new Error("no display");
      },
    });
    expect(bundle.accessToken).toBe("at");
  });
});
