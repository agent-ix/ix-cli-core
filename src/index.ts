export {
  atomicWrite,
  ConfigWriteError,
  ConfigSymlinkRefusedError,
} from "./atomic/write.js";

export {
  CORE_PLUGIN_ID,
  cacheRoot,
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
  _resetRegistryForTests,
  type RegisteredPlugin,
  type RegisterResult,
  type ConfigIncident,
} from "./config/registry.js";

// ── ixSchema plugin convention (FR-025 revised) ────────────────────────
export {
  registerPluginSchema,
  getRegisteredPluginSchema,
  listRegisteredPluginSchemas,
  type IxPluginSchema,
  type PluginSchemaRegistrationFailureReason,
  type PluginSchemaRegistrationResult,
  type RegisteredPluginSchema,
} from "./plugins/schema.js";

// ── BaseCommand + capability spec (FR-021, FR-022, FR-024) ─────────────
export { BaseCommand } from "./commands/base-command.js";
export type { CommandCapabilities } from "./runtime/capability-spec.js";

// ── Runtime ─────────────────────────────────────────────────────────────
export {
  configureRuntimeContext,
  getRuntimeContext,
  resetRuntimeContext,
  type RuntimeContext,
} from "./runtime/context.js";
export {
  capabilityErrorToJson,
  createCapabilityResolver,
  type BuiltInCapabilityId,
  type CapabilityError,
  type CapabilityErrorKind,
  type CapabilityProvider,
  type CapabilityProviderContext,
  type CapabilityResolver,
  type CapabilityResolverInput,
} from "./runtime/capabilities.js";

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
  EmptySecretValueError,
  UnknownSecretError,
  KeyringUnavailableError,
} from "./secrets/types.js";

export {
  registerSecret,
  registerSecretsForPlugin,
  getRegisteredSecret,
  listRegisteredSecrets,
  listSecretsForPlugin,
  isRegistered as isSecretRegistered,
  _resetSecretsRegistryForTests,
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
