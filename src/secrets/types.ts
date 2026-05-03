/** Branded `SecretId` shape: `"<plugin-id>.<secret-name>"`. */
export type SecretId = `${string}.${string}`;

const SECRET_ID_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

/**
 * Validate a `SecretId` against the FR-014-AC-8 regex. Returns true iff the
 * id is a single `<plugin-id>.<secret-name>` pair where each segment matches
 * `^[a-z][a-z0-9-]*$`.
 */
export function isValidSecretId(id: unknown): id is SecretId {
  return typeof id === "string" && SECRET_ID_RE.test(id);
}

export function assertValidSecretId(id: string): asserts id is SecretId {
  if (!isValidSecretId(id)) throw new InvalidSecretIdError(id);
}

export function splitSecretId(id: string): { pluginId: string; name: string } {
  assertValidSecretId(id);
  const dot = id.indexOf(".");
  return { pluginId: id.slice(0, dot), name: id.slice(dot + 1) };
}

/** Raised when a `SecretId` does not match the regex. The full id is rendered
 * verbatim — by definition, it is not a value (FR-014-AC-8). */
export class InvalidSecretIdError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(
      `invalid secret id ${JSON.stringify(id)} — must match /^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*$/`,
    );
    this.name = "InvalidSecretIdError";
    this.id = id;
  }
}

/**
 * A secret declaration carried by a plugin's `secretsSchema`. The full
 * `SecretId` is computed as `<plugin-id>.<name>`.
 */
export interface SecretDeclaration {
  /** Local name, e.g. `"ghcr-token"`. Combined with plugin id at registration. */
  name: string;
  /** Free-text shown by `ix secrets list` and prompts. */
  description: string;
  /** When true, login flows / commands MAY interactively prompt. */
  required?: boolean;
  /** Optional env-var binding (e.g. `"IX_GHCR_TOKEN"`). Beats backend on get(). */
  envVar?: string;
}

/** Outcome of `which(id)` — where `get(id)` is reading from right now. */
export type SecretSource = "env" | "keyring" | "age-file" | "unset";

/** Identifier for the configured persistence target — see FR-019 list table. */
export type SecretBackendId = "keyring" | "age-file";

/**
 * Pluggable backend interface (NFR-006). v1 ships `keyring` and
 * `age-file`. Future adapters (Vault, 1Password, Bitwarden) implement this
 * interface and register via `registerSecretsBackend`.
 */
export interface SecretsBackend {
  readonly id: SecretBackendId | string;

  /** One-shot capability check; cached for the process lifetime. */
  probe(): Promise<{ available: boolean; reason?: string }>;

  get(secretId: SecretId): Promise<string | null>;
  set(secretId: SecretId, value: string): Promise<void>;
  delete(secretId: SecretId): Promise<void>;
  list(): Promise<Array<{ secretId: SecretId }>>;
}

/** Raised when an env-bound secret is currently being shadowed by its env var. */
export class SecretBackendImmutableError extends Error {
  readonly id: string;
  readonly envVar: string;
  constructor(id: string, envVar: string) {
    super(
      `cannot set secret ${id}: env var ${envVar} is currently set and shadows the backend value — unset the env var or call SecretsService.set after clearing it`,
    );
    this.name = "SecretBackendImmutableError";
    this.id = id;
    this.envVar = envVar;
  }
}

/** Raised when an unknown secret id is passed to a SecretsService command. */
export class UnknownSecretError extends Error {
  readonly id: string;
  readonly registered: string[];
  constructor(id: string, registered: string[]) {
    super(
      `unknown secret id ${JSON.stringify(id)} — registered ids: ${registered.length === 0 ? "<none>" : registered.join(", ")}`,
    );
    this.name = "UnknownSecretError";
    this.id = id;
    this.registered = registered;
  }
}

/** Raised when a backend pinning conflicts with a failing capability probe. */
export class KeyringUnavailableError extends Error {
  readonly reason?: string;
  constructor(reason?: string) {
    super(
      `OS keyring is unavailable${reason ? `: ${reason}` : ""}. Install/start a Secret Service implementation (gnome-keyring / KWallet) or set core.secretsBackend = "age-file".`,
    );
    this.name = "KeyringUnavailableError";
    this.reason = reason;
  }
}
