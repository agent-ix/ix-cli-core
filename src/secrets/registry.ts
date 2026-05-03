import {
  assertValidSecretId,
  type SecretDeclaration,
  type SecretId,
} from "./types.js";

/**
 * Module-level registry of secret declarations. Keyed by full SecretId so a
 * plugin can register multiple secrets and so `ix secrets list` can render
 * description + envVar without re-traversing the plugin contract.
 */
export interface RegisteredSecret extends SecretDeclaration {
  pluginId: string;
  /** Full id `<pluginId>.<name>`. */
  id: SecretId;
}

/**
 * Outcome of `registerSecret`. Same first-wins discipline as the config
 * registry (FR-013-AC-3): a re-register with structurally identical
 * declaration is idempotent; a different declaration for the same id is
 * rejected and the first registration is preserved.
 */
export type SecretRegisterResult =
  | { ok: true; kind: "registered"; entry: RegisteredSecret }
  | { ok: true; kind: "idempotent"; entry: RegisteredSecret }
  | {
      ok: false;
      kind: "duplicate-id";
      existing: RegisteredSecret;
      attempted: RegisteredSecret;
    };

const secrets = new Map<string, RegisteredSecret>();

export function registerSecret(
  pluginId: string,
  decl: SecretDeclaration,
): SecretRegisterResult {
  const id = `${pluginId}.${decl.name}` as SecretId;
  assertValidSecretId(id);
  const entry: RegisteredSecret = { ...decl, pluginId, id };
  const existing = secrets.get(id);
  if (existing) {
    if (declarationsEqual(existing, entry)) {
      return { ok: true, kind: "idempotent", entry: existing };
    }
    return {
      ok: false,
      kind: "duplicate-id",
      existing,
      attempted: entry,
    };
  }
  secrets.set(id, entry);
  return { ok: true, kind: "registered", entry };
}

export function registerSecretsForPlugin(
  pluginId: string,
  decls: SecretDeclaration[],
): SecretRegisterResult[] {
  return decls.map((d) => registerSecret(pluginId, d));
}

export function getRegisteredSecret(id: string): RegisteredSecret | undefined {
  return secrets.get(id);
}

export function listRegisteredSecrets(): RegisteredSecret[] {
  return Array.from(secrets.values());
}

/** Subset of registered secrets whose plugin id matches `pluginId`. */
export function listSecretsForPlugin(pluginId: string): RegisteredSecret[] {
  const out: RegisteredSecret[] = [];
  for (const s of secrets.values()) {
    if (s.pluginId === pluginId) out.push(s);
  }
  return out;
}

export function isRegistered(id: string): boolean {
  return secrets.has(id);
}

function declarationsEqual(a: RegisteredSecret, b: RegisteredSecret): boolean {
  return (
    a.pluginId === b.pluginId &&
    a.name === b.name &&
    a.description === b.description &&
    a.envVar === b.envVar &&
    Boolean(a.required) === Boolean(b.required)
  );
}

/** Test-only: reset the registry between tests. */
export function _resetSecretsRegistryForTests(): void {
  secrets.clear();
}
