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

const secrets = new Map<string, RegisteredSecret>();

export function registerSecret(
  pluginId: string,
  decl: SecretDeclaration,
): RegisteredSecret {
  const id = `${pluginId}.${decl.name}` as SecretId;
  assertValidSecretId(id);
  const entry: RegisteredSecret = { ...decl, pluginId, id };
  secrets.set(id, entry);
  return entry;
}

export function registerSecretsForPlugin(
  pluginId: string,
  decls: SecretDeclaration[],
): RegisteredSecret[] {
  return decls.map((d) => registerSecret(pluginId, d));
}

export function getRegisteredSecret(id: string): RegisteredSecret | undefined {
  return secrets.get(id);
}

export function listRegisteredSecrets(): RegisteredSecret[] {
  return Array.from(secrets.values());
}

export function isRegistered(id: string): boolean {
  return secrets.has(id);
}

/** Test-only: reset the registry between tests. */
export function _resetSecretsRegistryForTests(): void {
  secrets.clear();
}
