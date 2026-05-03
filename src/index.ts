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

export { ConfigService, type PluginConfig } from "./config/service.js";
