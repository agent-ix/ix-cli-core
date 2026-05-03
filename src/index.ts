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

// ── Default secrets service (process-global, slice-10 init wiring) ──────
export {
  defaultSecretsService,
  setDefaultSecretsService,
  resetDefaultSecretsService,
} from "./secrets/default.js";

// ── ix config / ix secrets command runners (FR-018, FR-019) ─────────────
export {
  runConfigGet,
  runConfigSet,
  runConfigEdit,
  runConfigDoctor,
  UnknownPluginError,
  ConfigSetParseError,
} from "./commands/config.js";

export {
  runSecretsList,
  runSecretsSet,
  runSecretsRm,
  runSecretsWhich,
  newSecretsServiceForTesting,
  type SecretsCommandDeps,
} from "./commands/secrets.js";

// ── Legacy v0.1.2 API surface (transitional shims) ──────────────────────
// See packages/core/src/legacy/stubs.ts for context. These re-exports
// keep apps/ix and packages/elements compiling against the workspace
// package while their own callers migrate to the new SecretsService /
// ConfigService APIs.
export {
  installPlugin,
  listPlugins,
  removePlugin,
  loadPlugins,
  ensurePluginDir,
  readCredentials,
  writeCredentials,
  clearCredentials,
  isAuthenticated,
  getGithubToken,
  getIxToken,
  deviceFlow,
  exchangeGithubToken,
  refreshIxToken,
  saveIxTokens,
  loadIxCliConfig,
  saveIxCliConfig,
  type InstalledPlugin,
  type IxTokens,
  type IxCredentials,
  type IxCliConfig,
  type IxPlugin as LegacyIxPlugin,
  type IxPluginCommand,
} from "./legacy/stubs.js";
