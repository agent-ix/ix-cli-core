import { openBrowser } from "./browser-open.js";
import {
  DEVICE_CODE_GRANT_TYPE,
  type AgentixServiceDiscovery,
  type DeviceAuthorizeResponse,
  type DeviceTokenResponse,
  type TokenBundle,
} from "./types.js";

/**
 * Generic OAuth 2.0 Device Authorization Grant (RFC 8628) runner.
 *
 * `runDeviceFlow(discovery)`:
 *   1. POSTs the authorize endpoint to obtain `device_code` / `user_code`.
 *   2. Prints the `verification_uri` + `user_code` prominently (via the
 *      injected `prompter` so the host CLI controls rendering).
 *   3. Best-effort, non-fatal browser open of the verification URI.
 *   4. Polls the token endpoint, honoring `interval`, `slow_down` backoff,
 *      `authorization_pending`, `access_denied`, and `expired_token`.
 *
 * The runner is service-agnostic: every endpoint comes from `discovery`, and
 * the audience/scope are passed in by the caller. The default client id is
 * generic; IX supplies its own via options.
 */

/** Default OAuth client id for the CLI device-confirm client. */
export const DEFAULT_DEVICE_CLIENT_ID = "ix-cli";

/** Raised when the device flow ends without a token. */
export class DeviceFlowError extends Error {
  readonly code: DeviceFlowErrorCode;
  constructor(code: DeviceFlowErrorCode, message: string) {
    super(message);
    this.name = "DeviceFlowError";
    this.code = code;
  }
}

export type DeviceFlowErrorCode =
  | "access_denied"
  | "expired_token"
  | "authorize_failed"
  | "token_failed"
  | "aborted";

/**
 * Host-supplied presenter. The host CLI renders the verification prompt
 * through its own UI primitives; the engine never writes to stdout directly.
 */
export interface DeviceFlowPrompter {
  /** Show the verification URI + user code prominently. */
  showVerification(info: {
    verificationUri: string;
    verificationUriComplete?: string;
    userCode: string;
    serviceName?: string;
    browserOpened: boolean;
  }): void | Promise<void>;
  /** Optional status note while polling (e.g. "Waiting for approval…"). */
  note?: (message: string) => void | Promise<void>;
}

export interface RunDeviceFlowOptions {
  /** OAuth client id sent to authorize/token. Default `"ix-cli"`. */
  clientId?: string;
  /** Audience to request; defaults to `discovery.audience`. */
  audience?: string;
  /** Space-delimited scopes; defaults to `discovery.scopes_supported`. */
  scope?: string;
  /** Host UI presenter for the verification prompt + status notes. */
  prompter?: DeviceFlowPrompter;
  /** Try to open the verification URI in a browser. Default `true`. */
  openBrowser?: boolean;
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep (ms) for tests; defaults to real `setTimeout`. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable browser opener for tests; defaults to {@link openBrowser}. */
  openBrowserImpl?: (url: string) => Promise<boolean>;
  /** Absolute deadline override (epoch ms). Defaults from `expires_in`. */
  now?: () => number;
  /** Optional abort signal to cancel polling. */
  signal?: AbortSignal;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postForm(
  fetchImpl: typeof fetch,
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(fields).toString(),
    ...(signal ? { signal } : {}),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

/**
 * Run the device flow described by `discovery` to completion, returning the
 * normalized token bundle. Throws {@link DeviceFlowError} on denial,
 * expiry, or transport failure.
 */
export async function runDeviceFlow(
  discovery: AgentixServiceDiscovery,
  opts: RunDeviceFlowOptions = {},
): Promise<TokenBundle> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? realSleep;
  const now = opts.now ?? Date.now;
  const clientId = opts.clientId ?? DEFAULT_DEVICE_CLIENT_ID;
  const audience = opts.audience ?? discovery.audience;
  const scope = opts.scope ?? discovery.scopes_supported.join(" ");

  // ── 1. authorize ──────────────────────────────────────────────────────
  const authFields: Record<string, string> = { client_id: clientId };
  if (audience) authFields.audience = audience;
  if (scope) authFields.scope = scope;

  let authorize: { status: number; body: Record<string, unknown> };
  try {
    authorize = await postForm(
      fetchImpl,
      discovery.device_authorization_endpoint,
      authFields,
      opts.signal,
    );
  } catch (err) {
    throw new DeviceFlowError(
      "authorize_failed",
      `device authorize request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (authorize.status < 200 || authorize.status >= 300) {
    throw new DeviceFlowError(
      "authorize_failed",
      `device authorize returned HTTP ${authorize.status}` +
        describeError(authorize.body),
    );
  }
  const auth = authorize.body as unknown as DeviceAuthorizeResponse;
  if (
    typeof auth.device_code !== "string" ||
    typeof auth.user_code !== "string" ||
    typeof auth.verification_uri !== "string"
  ) {
    throw new DeviceFlowError(
      "authorize_failed",
      "device authorize response missing device_code / user_code / verification_uri",
    );
  }

  // ── 2. + 3. present + best-effort browser open ──────────────────────────
  const openUrl = auth.verification_uri_complete ?? auth.verification_uri;
  let browserOpened = false;
  if (opts.openBrowser !== false) {
    const open = opts.openBrowserImpl ?? openBrowser;
    try {
      browserOpened = await open(openUrl);
    } catch {
      browserOpened = false; // non-fatal
    }
  }
  if (opts.prompter?.showVerification) {
    await opts.prompter.showVerification({
      verificationUri: auth.verification_uri,
      verificationUriComplete: auth.verification_uri_complete,
      userCode: auth.user_code,
      serviceName: discovery.service?.name,
      browserOpened,
    });
  }

  // ── 4. poll token endpoint ──────────────────────────────────────────────
  const baseIntervalMs = Math.max(1, auth.interval ?? 5) * 1000;
  let intervalMs = baseIntervalMs;
  const startedAt = now();
  const expiresInMs = Math.max(0, auth.expires_in ?? 0) * 1000;
  const deadline =
    expiresInMs > 0 ? startedAt + expiresInMs : Number.POSITIVE_INFINITY;

  for (;;) {
    if (opts.signal?.aborted) {
      throw new DeviceFlowError("aborted", "device flow aborted");
    }
    await sleep(intervalMs);
    if (now() >= deadline) {
      throw new DeviceFlowError(
        "expired_token",
        "device code expired before approval; re-run login",
      );
    }

    let poll: { status: number; body: Record<string, unknown> };
    try {
      poll = await postForm(
        fetchImpl,
        discovery.device_token_endpoint,
        {
          grant_type: DEVICE_CODE_GRANT_TYPE,
          device_code: auth.device_code,
          client_id: clientId,
        },
        opts.signal,
      );
    } catch (err) {
      throw new DeviceFlowError(
        "token_failed",
        `device token poll failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Success — a 2xx token response.
    if (poll.status >= 200 && poll.status < 300 && poll.body.access_token) {
      const token = poll.body as unknown as DeviceTokenResponse;
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: now() + Math.max(0, token.expires_in ?? 0) * 1000,
        audience,
        scope: token.scope ?? scope,
      };
    }

    const error =
      typeof poll.body.error === "string" ? poll.body.error : undefined;

    switch (error) {
      case "authorization_pending":
        // Keep polling at the current interval.
        continue;
      case "slow_down":
        // RFC 8628: increase the interval by 5s on each slow_down.
        intervalMs += 5000;
        continue;
      case "access_denied":
        throw new DeviceFlowError(
          "access_denied",
          "login was denied in the browser",
        );
      case "expired_token":
        throw new DeviceFlowError(
          "expired_token",
          "device code expired before approval; re-run login",
        );
      default:
        // 428 with no/other error body is treated as still-pending; any
        // other non-2xx with an unrecognized error is fatal.
        if (poll.status === 428) continue;
        throw new DeviceFlowError(
          "token_failed",
          `device token poll returned HTTP ${poll.status}` +
            describeError(poll.body),
        );
    }
  }
}

function describeError(body: Record<string, unknown>): string {
  const error = typeof body.error === "string" ? body.error : undefined;
  const desc =
    typeof body.error_description === "string"
      ? body.error_description
      : undefined;
  if (!error && !desc) return "";
  return ` (${[error, desc].filter(Boolean).join(": ")})`;
}
