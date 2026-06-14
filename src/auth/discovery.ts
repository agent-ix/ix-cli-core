import type { AgentixServiceDiscovery } from "./types.js";

/**
 * Generic service-discovery client.
 *
 * `fetchServiceDiscovery(host)` normalizes a user-supplied host to an HTTPS
 * origin, fetches `/.well-known/agentix-service.json`, and validates the
 * minimal shape the device flow needs. The discovery contract is generic
 * (service-agnostic); IX defaults (e.g. `filament.dev.ix`) are supplied by the
 * consuming CLI, never baked in here.
 */

export const WELL_KNOWN_PATH = "/.well-known/agentix-service.json";

/** Raised when the supplied host cannot be normalized to a usable origin. */
export class DiscoveryHostError extends Error {
  readonly host: string;
  constructor(host: string, detail: string) {
    super(`invalid discovery host ${JSON.stringify(host)}: ${detail}`);
    this.name = "DiscoveryHostError";
    this.host = host;
  }
}

/** Raised when TLS is required but the resolved origin is plain http. */
export class DiscoveryInsecureError extends Error {
  readonly origin: string;
  constructor(origin: string) {
    super(
      `refusing to fetch service discovery over plain HTTP (${origin}). ` +
        `Use an https host, a *.dev.ix development host, or pass --insecure.`,
    );
    this.name = "DiscoveryInsecureError";
    this.origin = origin;
  }
}

/** Raised when the discovery request fails or returns a non-2xx status. */
export class DiscoveryFetchError extends Error {
  readonly url: string;
  readonly status?: number;
  constructor(url: string, detail: string, status?: number) {
    super(`failed to fetch service discovery from ${url}: ${detail}`);
    this.name = "DiscoveryFetchError";
    this.url = url;
    this.status = status;
  }
}

/** Raised when the discovery document is missing required fields. */
export class DiscoverySchemaError extends Error {
  readonly url: string;
  readonly missing: string[];
  constructor(url: string, missing: string[]) {
    super(
      `service discovery document at ${url} is missing required field(s): ${missing.join(", ")}`,
    );
    this.name = "DiscoverySchemaError";
    this.url = url;
    this.missing = missing;
  }
}

export interface FetchServiceDiscoveryOptions {
  /**
   * Allow plain-HTTP origins for any host (not just `*.dev.ix`). Maps to the
   * CLI's `--insecure` flag. Default `false`.
   */
  insecure?: boolean;
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. Default 15000. */
  timeoutMs?: number;
}

/**
 * Normalize a user-supplied host to an origin.
 *
 * Accepts bare hosts (`filament.dev.ix`), hosts with a scheme
 * (`https://filament.dev.ix`), and hosts carrying a path/port; the path is
 * dropped. HTTPS is assumed when no scheme is given. Plain HTTP is permitted
 * only for `*.dev.ix` hosts or when `insecure` is set — otherwise
 * `DiscoveryInsecureError` is thrown.
 */
export function normalizeHostOrigin(host: string, insecure = false): string {
  const trimmed = (host ?? "").trim();
  if (trimmed.length === 0) {
    throw new DiscoveryHostError(host, "host is empty");
  }

  let url: URL;
  try {
    url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
  } catch (err) {
    throw new DiscoveryHostError(
      host,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DiscoveryHostError(
      host,
      `unsupported scheme ${url.protocol} (only http/https)`,
    );
  }
  if (!url.hostname) {
    throw new DiscoveryHostError(host, "no hostname");
  }

  if (url.protocol === "http:") {
    const isDevIx =
      url.hostname === "dev.ix" || url.hostname.endsWith(".dev.ix");
    if (!isDevIx && !insecure) {
      throw new DiscoveryInsecureError(url.origin);
    }
  }

  return url.origin;
}

/** Type guard / validator for the discovery document shape. */
function assertDiscoveryShape(
  url: string,
  value: unknown,
): asserts value is AgentixServiceDiscovery {
  if (value === null || typeof value !== "object") {
    throw new DiscoverySchemaError(url, ["<document is not an object>"]);
  }
  const doc = value as Record<string, unknown>;
  const missing: string[] = [];

  const requireString = (key: string): void => {
    if (typeof doc[key] !== "string" || (doc[key] as string).length === 0) {
      missing.push(key);
    }
  };

  requireString("schema_version");
  requireString("issuer");
  requireString("audience");
  requireString("device_authorization_endpoint");
  requireString("device_token_endpoint");
  requireString("device_request_endpoint");
  requireString("approval_uri");
  requireString("token_refresh_endpoint");

  const service = doc.service;
  if (
    service === null ||
    typeof service !== "object" ||
    typeof (service as Record<string, unknown>).name !== "string"
  ) {
    missing.push("service.name");
  }

  if (!Array.isArray(doc.scopes_supported)) {
    missing.push("scopes_supported");
  }

  if (missing.length > 0) {
    throw new DiscoverySchemaError(url, missing);
  }
}

/**
 * Fetch and validate the service discovery document for `host`.
 *
 * Throws `DiscoveryHostError` / `DiscoveryInsecureError` for host problems,
 * `DiscoveryFetchError` for transport / non-2xx, and `DiscoverySchemaError`
 * when required fields are absent.
 */
export async function fetchServiceDiscovery(
  host: string,
  opts: FetchServiceDiscoveryOptions = {},
): Promise<AgentixServiceDiscovery> {
  const origin = normalizeHostOrigin(host, opts.insecure ?? false);
  const url = `${origin}${WELL_KNOWN_PATH}`;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    throw new DiscoveryFetchError(
      url,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new DiscoveryFetchError(
      url,
      `HTTP ${res.status} ${res.statusText}`,
      res.status,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new DiscoveryFetchError(
      url,
      `response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  assertDiscoveryShape(url, body);
  return body;
}
