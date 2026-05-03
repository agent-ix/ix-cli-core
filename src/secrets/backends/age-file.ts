import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  Decrypter,
  Encrypter,
  generateIdentity,
  identityToRecipient,
} from "age-encryption";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { atomicWrite } from "../../atomic/write.js";
import { configRoot } from "../../config/paths.js";
import { splitSecretId, type SecretId, type SecretsBackend } from "../types.js";

const SECRETS_KEY_NAME = "secrets.key";
const SECRETS_D_NAME = "secrets.d";
const MODE_OWNER_RW = 0o600;
const AGE_IDENTITY_PREFIX = "AGE-SECRET-KEY-1";

/**
 * Age-encrypted, per-plugin file backend (FR-016, NFR-003, NFR-004).
 *
 * Identity:   `<configRoot>/secrets.key`            (X25519, mode 0o600)
 * Blobs:      `<configRoot>/secrets.d/<plugin>.age` (mode 0o600)
 *
 * Each plugin's blob plaintext is a YAML object keyed by secret name. A
 * single `set/get/delete` round-trips the blob — load → decrypt → mutate →
 * encrypt → atomic write — touching only the requesting plugin's file.
 *
 * Selected only when the keyring capability probe fails (FR-014, FR-015).
 */
export class AgeFileBackend implements SecretsBackend {
  readonly id = "age-file";
  private identityCache?: string;
  private recipientCache?: string;

  /**
   * Override the configuration root. Tests pass an isolated tempdir; in
   * production the resolver consults `XDG_CONFIG_HOME` via `configRoot()`.
   */
  constructor(private readonly rootOverride?: string) {}

  async probe(): Promise<{ available: boolean; reason?: string }> {
    // Ensure we can create the parent dir; the actual identity is
    // generated lazily on first use.
    try {
      ensureDir(this.root());
      return { available: true };
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  }

  async get(secretId: SecretId): Promise<string | null> {
    const { pluginId, name } = splitSecretId(secretId);
    const blob = await this.loadBlob(pluginId);
    return blob.has(name) ? (blob.get(name) ?? null) : null;
  }

  async set(secretId: SecretId, value: string): Promise<void> {
    const { pluginId, name } = splitSecretId(secretId);
    const blob = await this.loadBlob(pluginId);
    blob.set(name, value);
    await this.saveBlob(pluginId, blob);
  }

  async delete(secretId: SecretId): Promise<void> {
    const { pluginId, name } = splitSecretId(secretId);
    const blob = await this.loadBlob(pluginId);
    if (!blob.delete(name)) return;
    if (blob.size === 0) {
      // Empty plugin blob → remove the file rather than encrypt an empty
      // map, so the on-disk surface area shrinks.
      const path = this.blobPath(pluginId);
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
      return;
    }
    await this.saveBlob(pluginId, blob);
  }

  async list(): Promise<Array<{ secretId: SecretId }>> {
    const out: Array<{ secretId: SecretId }> = [];
    let entries: string[];
    try {
      entries = readdirSync(this.blobsDir());
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".age")) continue;
      const pluginId = entry.slice(0, -4);
      try {
        const blob = await this.loadBlob(pluginId);
        for (const name of blob.keys()) {
          out.push({ secretId: `${pluginId}.${name}` as SecretId });
        }
      } catch (err) {
        // FR-016-AC-3: a corrupted blob is contained to one plugin. Skip
        // it in `list`; the user will see the failure when they hit the
        // affected plugin's secret directly.
        void err;
      }
    }
    return out;
  }

  // ── internal ───────────────────────────────────────────────────────────

  private root(): string {
    return this.rootOverride ?? configRoot();
  }

  private identityPath(): string {
    return join(this.root(), SECRETS_KEY_NAME);
  }

  private blobsDir(): string {
    return join(this.root(), SECRETS_D_NAME);
  }

  private blobPath(pluginId: string): string {
    return join(this.blobsDir(), `${pluginId}.age`);
  }

  /** Load (and cache) the age identity, generating + persisting one if absent. */
  private async loadOrCreateIdentity(): Promise<{
    identity: string;
    recipient: string;
  }> {
    if (this.identityCache && this.recipientCache) {
      return { identity: this.identityCache, recipient: this.recipientCache };
    }

    const identityPath = this.identityPath();
    refuseSymlink(identityPath);

    if (existsSync(identityPath)) {
      const st = statSync(identityPath);
      const mode = st.mode & 0o777;
      // NFR-004-AC-3 / FR-016-AC-5: identity must be exactly 0o600.
      // Any group/other bit OR an owner-execute bit voids the trust boundary.
      if (mode !== MODE_OWNER_RW) {
        throw new SecretsIdentityPermissionsError(identityPath, mode);
      }
      const text = readFileSync(identityPath, "utf8").trim();
      if (!text.startsWith(AGE_IDENTITY_PREFIX)) {
        throw new Error(
          `${identityPath} does not contain a valid AGE-SECRET-KEY identity`,
        );
      }
      this.identityCache = text;
      this.recipientCache = await identityToRecipient(text);
      return { identity: text, recipient: this.recipientCache };
    }

    const identity = await generateIdentity();
    ensureDir(this.root());
    atomicWrite(identityPath, `${identity}\n`);
    this.identityCache = identity;
    this.recipientCache = await identityToRecipient(identity);
    return { identity, recipient: this.recipientCache };
  }

  private async loadBlob(pluginId: string): Promise<Map<string, string>> {
    const path = this.blobPath(pluginId);
    if (!existsSync(path)) return new Map();
    refuseSymlink(path);
    const cipherBytes = readFileSync(path);
    const { identity } = await this.loadOrCreateIdentity();
    let plaintextBytes: Uint8Array;
    try {
      const d = new Decrypter();
      d.addIdentity(identity);
      plaintextBytes = await d.decrypt(
        new Uint8Array(cipherBytes),
        "uint8array",
      );
    } catch (cause) {
      throw new SecretsBlobCorruptedError(pluginId, path, cause);
    }
    const text = new TextDecoder().decode(plaintextBytes);
    const parsed = text.length === 0 ? {} : parseYaml(text);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SecretsBlobCorruptedError(
        pluginId,
        path,
        new Error("decrypted blob is not a YAML object"),
      );
    }
    const out = new Map<string, string>();
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") {
        throw new SecretsBlobCorruptedError(
          pluginId,
          path,
          new Error(`secret value for ${k} is not a string`),
        );
      }
      out.set(k, v);
    }
    return out;
  }

  private async saveBlob(
    pluginId: string,
    blob: Map<string, string>,
  ): Promise<void> {
    const path = this.blobPath(pluginId);
    ensureDir(this.blobsDir());
    const obj: Record<string, string> = {};
    for (const [k, v] of blob) obj[k] = v;
    const yaml = stringifyYaml(obj, { lineWidth: 0 });
    const { recipient } = await this.loadOrCreateIdentity();
    const e = new Encrypter();
    e.addRecipient(recipient);
    const cipher = await e.encrypt(yaml);
    atomicWrite(path, cipher);
  }
}

function ensureDir(dir: string): void {
  try {
    const st = statSync(dir);
    if (!st.isDirectory()) throw new Error(`expected directory at ${dir}`);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      return;
    }
    throw err;
  }
  // Best-effort: also ensure the parent exists for callers that pass deep paths.
  void dirname;
}

function refuseSymlink(path: string): void {
  let st;
  try {
    st = lstatSync(path);
  } catch (err) {
    if ((err as { code?: string })?.code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`refusing to access symlinked path: ${path}`);
  }
}

export class SecretsIdentityPermissionsError extends Error {
  readonly path: string;
  readonly observedMode: number;
  constructor(path: string, observedMode: number) {
    super(
      `secrets identity ${path} has mode 0o${observedMode.toString(8).padStart(3, "0")} — must be 0o600. Run \`chmod 0600 ${path}\` and retry.`,
    );
    this.name = "SecretsIdentityPermissionsError";
    this.path = path;
    this.observedMode = observedMode;
  }
}

export class SecretsBlobCorruptedError extends Error {
  readonly pluginId: string;
  readonly path: string;
  constructor(pluginId: string, path: string, cause: unknown) {
    super(
      `secrets blob for plugin ${pluginId} at ${path} is corrupted: ${(cause as Error)?.message ?? String(cause)}. Delete the file and re-enter the plugin's secrets, or restore from backup.`,
    );
    this.name = "SecretsBlobCorruptedError";
    this.pluginId = pluginId;
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Convenience constructor — used by the apps/ix init hook (slice 10) and
 * by tests. The `XDG_CONFIG_HOME` env var is honored automatically since
 * the backend defers to `configRoot()`.
 */
export function newAgeFileBackend(rootOverride?: string): AgeFileBackend {
  return new AgeFileBackend(rootOverride);
}

/** Re-exported convenience to honor the homedir() side of configRoot(). */
export const __defaultRoot = () => join(homedir(), ".config", "ix");
