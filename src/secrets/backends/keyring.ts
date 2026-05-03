import { randomBytes } from "node:crypto";

import {
  KeyringUnavailableError,
  splitSecretId,
  type SecretId,
  type SecretsBackend,
} from "../types.js";

const SERVICE = "ix-cli";
const PROBE_ACCOUNT = "core.__probe__";
const NOT_FOUND_PATTERNS = [
  "no matching",
  "not found",
  "no such",
  "Item not found",
  "no entry",
  "Secret Service: not found",
];

interface KeyringEntryShape {
  setPassword(value: string): void;
  getPassword(): string;
  deletePassword(): boolean | void;
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntryShape;
  findCredentials?: (
    service: string,
  ) => Array<{ account: string; password: string }>;
}

/**
 * OS keyring backend (FR-015). Wraps `@napi-rs/keyring`:
 *
 * - macOS: Keychain
 * - Linux: Secret Service via libsecret (gnome-keyring / KWallet)
 * - Windows: Credential Manager
 *
 * service = "ix-cli", account = "<plugin-id>.<secret-name>".
 *
 * The capability probe performs a round-trip set/get/delete on a sentinel
 * secret. On any failure (binding load, missing dbus on Linux, no Secret
 * Service daemon, denied prompt) the probe returns `available: false` and
 * `SecretsService` will fall through to the age-file backend (auto mode)
 * or surface `KeyringUnavailableError` (pinned mode).
 */
export class KeyringBackend implements SecretsBackend {
  readonly id = "keyring";
  private mod?: KeyringModule;
  private probedAvailable: boolean | undefined;
  private probeReason?: string;

  constructor(mod?: KeyringModule) {
    if (mod) this.mod = mod;
  }

  async probe(): Promise<{ available: boolean; reason?: string }> {
    if (this.probedAvailable !== undefined) {
      return this.probedAvailable
        ? { available: true }
        : { available: false, reason: this.probeReason };
    }
    try {
      const mod = await this.loadModule();
      const sentinelValue = `probe-${randomBytes(8).toString("hex")}`;
      const entry = new mod.Entry(SERVICE, PROBE_ACCOUNT);
      entry.setPassword(sentinelValue);
      const got = entry.getPassword();
      entry.deletePassword();
      if (got !== sentinelValue) {
        this.probedAvailable = false;
        this.probeReason = "round-trip value mismatch";
        return { available: false, reason: this.probeReason };
      }
      this.probedAvailable = true;
      return { available: true };
    } catch (err) {
      this.probedAvailable = false;
      this.probeReason = (err as Error).message;
      return { available: false, reason: this.probeReason };
    }
  }

  async get(secretId: SecretId): Promise<string | null> {
    const mod = await this.requireAvailable();
    const account = secretId; // already validated upstream as <pluginId>.<name>
    splitSecretId(secretId); // sanity, throws InvalidSecretIdError on malformed
    const entry = new mod.Entry(SERVICE, account);
    try {
      return entry.getPassword();
    } catch (err) {
      if (isNotFound(err as Error)) return null;
      throw new KeyringAccessError(secretId, err as Error);
    }
  }

  async set(secretId: SecretId, value: string): Promise<void> {
    const mod = await this.requireAvailable();
    splitSecretId(secretId);
    const entry = new mod.Entry(SERVICE, secretId);
    try {
      entry.setPassword(value);
    } catch (err) {
      throw new KeyringAccessError(secretId, err as Error);
    }
  }

  async delete(secretId: SecretId): Promise<void> {
    const mod = await this.requireAvailable();
    splitSecretId(secretId);
    const entry = new mod.Entry(SERVICE, secretId);
    try {
      entry.deletePassword();
    } catch (err) {
      if (isNotFound(err as Error)) return;
      throw new KeyringAccessError(secretId, err as Error);
    }
  }

  async list(): Promise<Array<{ secretId: SecretId }>> {
    const mod = await this.requireAvailable();
    if (typeof mod.findCredentials !== "function") return [];
    let creds: Array<{ account: string }>;
    try {
      creds = mod.findCredentials(SERVICE);
    } catch {
      return [];
    }
    const out: Array<{ secretId: SecretId }> = [];
    for (const { account } of creds) {
      if (account === PROBE_ACCOUNT) continue;
      // Only return well-formed account names matching `<plugin>.<name>`.
      if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(account)) continue;
      out.push({ secretId: account as SecretId });
    }
    return out;
  }

  // ── internal ───────────────────────────────────────────────────────────

  private async loadModule(): Promise<KeyringModule> {
    if (this.mod) return this.mod;
    try {
      const m = (await import("@napi-rs/keyring")) as unknown as KeyringModule;
      this.mod = m;
      return m;
    } catch (err) {
      throw new KeyringUnavailableError(
        `failed to load @napi-rs/keyring: ${(err as Error).message}`,
      );
    }
  }

  private async requireAvailable(): Promise<KeyringModule> {
    const mod = await this.loadModule();
    if (this.probedAvailable === undefined) {
      const r = await this.probe();
      if (!r.available) throw new KeyringUnavailableError(r.reason);
    } else if (!this.probedAvailable) {
      throw new KeyringUnavailableError(this.probeReason);
    }
    return mod;
  }
}

function isNotFound(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return NOT_FOUND_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
}

/** Raised when the keyring backend is loaded but a specific operation fails. */
export class KeyringAccessError extends Error {
  readonly secretId: string;
  constructor(secretId: string, cause: Error) {
    const remediation = remediationHint();
    super(
      `keyring access failed for ${secretId}: ${cause.message}${remediation ? ` — ${remediation}` : ""}`,
    );
    this.name = "KeyringAccessError";
    this.secretId = secretId;
    this.cause = cause;
  }
}

function remediationHint(): string {
  switch (process.platform) {
    case "darwin":
      return "open Keychain Access and grant the ix-cli the requested permission";
    case "linux":
      return "ensure gnome-keyring or KWallet is running and unlocked (for headless: install + start gnome-keyring-daemon)";
    case "win32":
      return "open Credential Manager (control /name Microsoft.CredentialManager) and verify the entry";
    default:
      return "verify your platform credential store is reachable";
  }
}

export function newKeyringBackend(): KeyringBackend {
  return new KeyringBackend();
}
