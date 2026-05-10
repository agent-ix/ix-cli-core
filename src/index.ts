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
  type RegisterResult,
  type ConfigIncident,
} from "./config/registry.js";

// ── Plugin contract ────────────────────────────────────────────────────
export {
  registerIxPlugin,
  getRegisteredIxPlugin,
  listRegisteredIxPlugins,
  type IxPluginRegistrationFailureReason,
  type IxPluginRegistrationResult,
} from "./plugins/registry.js";
export type {
  IxCapabilityDeclaration,
  IxCapabilityMode,
  IxCommandRegistration,
  IxPlugin,
  RegisteredIxPlugin,
} from "./plugins/types.js";

// ── Runtime ─────────────────────────────────────────────────────────────
export {
  configureRuntimeContext,
  getRuntimeContext,
  resetRuntimeContext,
  type RuntimeContext,
} from "./runtime/context.js";
export {
  configureDistributionRuntime,
  createRuntimeDistribution,
  defaultConfigRoot,
  parseConfigRootFlag,
  selectRuntimeConfigRoot,
  type ConfigureDistributionRuntimeInput,
  type IxRuntimeDistribution,
  type RuntimeConfigRootSelection,
} from "./runtime/distribution.js";
export {
  PluginManifestEntrySchema,
  PluginManifestSchema,
  loadPluginManifestLayers,
  parsePluginManifest,
  resolvePluginManifestLayers,
  type PluginLoadResult,
  type PluginManifest,
  type PluginManifestDiagnostic,
  type PluginManifestEntry,
  type PluginManifestLayer,
  type PluginModuleResolver,
  type ResolvedPluginManifestEntry,
} from "./runtime/manifest.js";
export {
  capabilityErrorToJson,
  createCapabilityResolver,
  requiredCapabilitiesFor,
  type BuiltInCapabilityId,
  type CapabilityError,
  type CapabilityErrorKind,
  type CapabilityProvider,
  type CapabilityProviderContext,
  type CapabilityResolver,
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
