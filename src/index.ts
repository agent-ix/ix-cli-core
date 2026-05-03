export {
  atomicWrite,
  ConfigWriteError,
  ConfigSymlinkRefusedError,
} from "./atomic/write.js";

export {
  CORE_PLUGIN_ID,
  configPathFor,
  configRoot,
  configDRoot,
  isValidPluginId,
  validatePluginIdOrThrow,
  InvalidPluginIdError,
} from "./config/paths.js";

export {
  ConfigSchemaError,
  ConfigParseError,
  type ConfigIssue,
  issuesFromZod,
} from "./config/errors.js";

export {
  ConfigService,
  type PluginConfig,
  type ForPluginOptions,
} from "./config/service.js";

export { withFileLock, ConfigLockTimeoutError } from "./config/lock.js";

export {
  doctor,
  type DoctorReport,
  type DoctorEntry,
} from "./config/doctor.js";

export {
  registerPlugin,
  getRegisteredPlugin,
  listRegisteredPlugins,
  listIncidents,
  type RegisteredPlugin,
  type ConfigIncident,
} from "./config/registry.js";

// ── Secrets ──────────────────────────────────────────────────────────────
export {
  type SecretId,
  type SecretSource,
  type SecretBackendId,
  type SecretsBackend,
  type SecretDeclaration,
  isValidSecretId,
  assertValidSecretId,
  splitSecretId,
  InvalidSecretIdError,
  SecretBackendImmutableError,
  UnknownSecretError,
  KeyringUnavailableError,
} from "./secrets/types.js";

export {
  registerSecret,
  registerSecretsForPlugin,
  getRegisteredSecret,
  listRegisteredSecrets,
  isRegistered as isSecretRegistered,
  type RegisteredSecret,
} from "./secrets/registry.js";

export {
  SecretsService,
  type SecretsServiceOptions,
  type SecretsBackendMode,
} from "./secrets/service.js";

export { MemoryBackend } from "./secrets/backends/memory.js";

export {
  AgeFileBackend,
  newAgeFileBackend,
  SecretsIdentityPermissionsError,
  SecretsBlobCorruptedError,
} from "./secrets/backends/age-file.js";

export {
  KeyringBackend,
  newKeyringBackend,
  KeyringAccessError,
} from "./secrets/backends/keyring.js";

// ── Legacy migration (FR-017) ────────────────────────────────────────────
export {
  runLegacyMigration,
  type LegacyMigrationOptions,
  type LegacyMigrationReport,
} from "./migration/legacy.js";
