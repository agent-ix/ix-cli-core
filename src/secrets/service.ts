import {
  assertValidSecretId,
  KeyringUnavailableError,
  SecretBackendImmutableError,
  UnknownSecretError,
  type SecretBackendId,
  type SecretId,
  type SecretSource,
  type SecretsBackend,
} from "./types.js";
import { getRegisteredSecret, listRegisteredSecrets } from "./registry.js";

/**
 * Backend-selection mode. `auto` means: keyring if its probe succeeds, else
 * age-file. `keyring` and `age-file` pin the choice; any pinned mode whose
 * probe fails causes operations to throw `KeyringUnavailableError` (per
 * NFR-006-AC-5) — no silent fallback when the operator pinned a backend.
 */
export type SecretsBackendMode = "auto" | "keyring" | "age-file" | string;

export interface SecretsServiceOptions {
  /** The backend selection mode. Usually sourced from `core.secretsBackend`. */
  mode?: SecretsBackendMode;
  /**
   * Map of registered backend id → adapter. v1 ships `keyring` and
   * `age-file`; tests inject a `memory` backend; future packages register
   * via this same map (NFR-006).
   */
  backends?: Map<string, SecretsBackend>;
  /** Optional override of `process.env`, useful for tests. */
  env?: Record<string, string | undefined>;
}

/**
 * Read/write access to plugin secrets.
 *
 * Resolution order for `get(id)`:
 *
 *   1. Env-var declared by the secret's `envVar` binding (FR-014-AC-1).
 *   2. Active backend (FR-014-AC-2).
 *   3. Otherwise `null`. Callers requesting an interactive prompt must
 *      drive that themselves (the `ix secrets set` command does so).
 */
export class SecretsService {
  private readonly mode: SecretsBackendMode;
  private readonly backends: Map<string, SecretsBackend>;
  private readonly env: Record<string, string | undefined>;
  private activeId: SecretBackendId | string | undefined;
  private probed = false;

  constructor(opts: SecretsServiceOptions = {}) {
    this.mode = opts.mode ?? "auto";
    this.backends = opts.backends ?? new Map();
    this.env = opts.env ?? process.env;
  }

  /** Active backend after probing, or undefined if no backend is selected. */
  async activeBackend(): Promise<SecretsBackend> {
    if (!this.probed) await this.probeAndSelect();
    const id = this.activeId;
    if (!id) {
      throw new KeyringUnavailableError(
        "no backend was selected (registered backends: " +
          [...this.backends.keys()].join(", ") +
          ")",
      );
    }
    const backend = this.backends.get(id);
    if (!backend) {
      throw new KeyringUnavailableError(`backend ${id} is not registered`);
    }
    return backend;
  }

  /** The id of the active backend (after probing). */
  async activeBackendId(): Promise<SecretBackendId | string> {
    if (!this.probed) await this.probeAndSelect();
    if (!this.activeId) {
      throw new KeyringUnavailableError(
        `mode "${this.mode}" yielded no available backend`,
      );
    }
    return this.activeId;
  }

  async get(id: string): Promise<string | null> {
    assertValidSecretId(id);
    const decl = getRegisteredSecret(id);
    if (decl?.envVar) {
      const v = this.env[decl.envVar];
      if (v !== undefined && v !== "") return v;
    }
    const backend = await this.activeBackend();
    return backend.get(id as SecretId);
  }

  async set(id: string, value: string): Promise<void> {
    assertValidSecretId(id);
    const decl = getRegisteredSecret(id);
    if (decl?.envVar) {
      const v = this.env[decl.envVar];
      if (v !== undefined && v !== "") {
        // FR-014-AC-6: cannot set when env shadow is active.
        throw new SecretBackendImmutableError(id, decl.envVar);
      }
    }
    const backend = await this.activeBackend();
    await backend.set(id as SecretId, value);
  }

  async delete(id: string): Promise<void> {
    assertValidSecretId(id);
    const backend = await this.activeBackend();
    await backend.delete(id as SecretId);
  }

  /**
   * Resolution outcome at this instant. Returns `env` whenever the bound
   * env var is currently set, regardless of backend state (FR-019-AC-3).
   */
  async which(id: string): Promise<SecretSource> {
    assertValidSecretId(id);
    const decl = getRegisteredSecret(id);
    if (decl?.envVar) {
      const v = this.env[decl.envVar];
      if (v !== undefined && v !== "") return "env";
    }
    const backend = await this.activeBackend();
    const value = await backend.get(id as SecretId);
    if (value === null) return "unset";
    if (backend.id === "keyring") return "keyring";
    if (backend.id === "age-file") return "age-file";
    // Future backends: report their id verbatim. Callers narrow against
    // the known SecretSource union if they need exhaustiveness.
    return backend.id as SecretSource;
  }

  /**
   * Snapshot of all declared secrets and their resolution outcomes —
   * never includes the value (FR-019-AC-1).
   */
  async list(): Promise<
    Array<{
      id: string;
      backend: string;
      source: SecretSource;
      description: string;
    }>
  > {
    const backendId = await this.activeBackendId();
    const out: Array<{
      id: string;
      backend: string;
      source: SecretSource;
      description: string;
    }> = [];
    for (const decl of listRegisteredSecrets()) {
      out.push({
        id: decl.id,
        backend: backendId,
        source: await this.which(decl.id),
        description: decl.description,
      });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  }

  /**
   * Throws `UnknownSecretError` if `id` is not in the registered set; useful
   * at command boundaries (FR-019-AC-5).
   */
  static assertRegistered(id: string): void {
    if (!getRegisteredSecret(id)) {
      throw new UnknownSecretError(
        id,
        listRegisteredSecrets()
          .map((s) => s.id)
          .sort(),
      );
    }
  }

  // ── internal ───────────────────────────────────────────────────────────

  private async probeAndSelect(): Promise<void> {
    this.probed = true;

    if (this.mode === "auto") {
      // Try keyring first, fall through to age-file.
      const keyring = this.backends.get("keyring");
      if (keyring) {
        const r = await keyring.probe();
        if (r.available) {
          this.activeId = keyring.id;
          return;
        }
      }
      const ageFile = this.backends.get("age-file");
      if (ageFile) {
        const r = await ageFile.probe();
        if (r.available) {
          this.activeId = ageFile.id;
          return;
        }
      }
      // Neither available → leave activeId undefined; activeBackend() throws.
      return;
    }

    // Pinned mode (specific backend id).
    const pinned = this.backends.get(this.mode);
    if (!pinned) {
      // Unknown backend id; refuse silently — callers see the error when
      // they hit activeBackend.
      return;
    }
    const r = await pinned.probe();
    if (r.available) {
      this.activeId = pinned.id;
    } else if (this.mode === "keyring") {
      // NFR-006-AC-5: pinned keyring + failing probe MUST throw, not
      // silently fall through. We surface this on every operation by
      // leaving activeId undefined and throwing in activeBackend().
      throw new KeyringUnavailableError(r.reason);
    }
  }
}
