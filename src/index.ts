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
