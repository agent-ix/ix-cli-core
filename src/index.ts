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

// ── Marketplace adapter over @agent-ix/ts-plugin-kit (FR-019) ──────────
// Thin wiring: ix-cli-core adapts the external marketplace library (cache
// layout + oclif command-plugin bridge); it does NOT implement an installer.
export {
  marketplaceInstallOptions,
  reconcileDefaultSet,
  type MarketplaceTarget,
} from "./marketplace/adapter.js";
export {
  resolveOclifPluginInstall,
  type OclifPluginInstall,
} from "./marketplace/oclif-bridge.js";
export type {
  MarketplaceManifest,
  MarketplaceEntry,
  Source,
} from "@agent-ix/ts-plugin-kit";

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

// ── Auth engine (FR-015..FR-018) ─────────────────────────────────────────
// Generic, service-agnostic device-flow login: discovery client, runner,
// host-keyed token store, and a non-fatal browser opener. Service identity
// and CLI defaults are supplied by the consuming binary.
export {
  // discovery
  fetchServiceDiscovery,
  normalizeHostOrigin,
  WELL_KNOWN_PATH,
  DiscoveryHostError,
  DiscoveryInsecureError,
  DiscoveryFetchError,
  DiscoverySchemaError,
  type FetchServiceDiscoveryOptions,
  // device-flow runner
  runDeviceFlow,
  DeviceFlowError,
  DEFAULT_DEVICE_CLIENT_ID,
  DEVICE_CODE_GRANT_TYPE,
  type DeviceFlowErrorCode,
  type DeviceFlowPrompter,
  type RunDeviceFlowOptions,
  // token store
  TokenStore,
  MemoryTokenMetaStore,
  NotAuthenticatedError,
  TokenRefreshError,
  hostSlug,
  DEFAULT_TOKEN_PLUGIN_ID,
  DEFAULT_REFRESH_SKEW_MS,
  type TokenMetaStore,
  type TokenStoreOptions,
  type GetAccessTokenOptions,
  // browser
  openBrowser,
  // contract types
  type AgentixServiceDiscovery,
  type ServiceIdentity,
  type DeviceAuthorizeRequest,
  type DeviceAuthorizeResponse,
  type DeviceTokenRequest,
  type DeviceTokenResponse,
  type DeviceTokenError,
  type TokenBundle,
  type TokenMeta,
} from "./auth/index.js";
