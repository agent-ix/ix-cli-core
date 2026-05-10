import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { IxPlugin } from "../plugins/types.js";
import { configureRuntimeContext } from "./context.js";

export interface IxRuntimeDistribution {
  id: string;
  binaryName: string;
  configNamespace: string;
  configRootEnvVar: string;
  defaultPlugins: IxPlugin[];
  ixServicesEnabled: boolean;
  defaults?: Record<string, Record<string, unknown>>;
}

export interface RuntimeConfigRootSelection {
  root: string;
  source: "flag" | "env" | "default";
}

export interface ConfigureDistributionRuntimeInput {
  distribution: IxRuntimeDistribution;
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  noProjectConfig?: boolean;
}

export function createRuntimeDistribution(
  distribution: IxRuntimeDistribution,
): IxRuntimeDistribution {
  return {
    ...distribution,
    defaultPlugins: [...distribution.defaultPlugins],
    defaults: cloneDefaults(distribution.defaults),
  };
}

export function selectRuntimeConfigRoot(input: {
  distribution: Pick<
    IxRuntimeDistribution,
    "configNamespace" | "configRootEnvVar"
  >;
  flagConfigRoot?: string;
  env?: NodeJS.ProcessEnv;
}): RuntimeConfigRootSelection {
  if (input.flagConfigRoot && input.flagConfigRoot.length > 0) {
    return { root: resolve(input.flagConfigRoot), source: "flag" };
  }
  const env = input.env ?? process.env;
  const envRoot = env[input.distribution.configRootEnvVar];
  if (envRoot && envRoot.length > 0) {
    return { root: resolve(envRoot), source: "env" };
  }
  return {
    root: defaultConfigRoot(input.distribution.configNamespace, env),
    source: "default",
  };
}

export function configureDistributionRuntime(
  input: ConfigureDistributionRuntimeInput,
): RuntimeConfigRootSelection {
  const selection = selectRuntimeConfigRoot({
    distribution: input.distribution,
    flagConfigRoot: parseConfigRootFlag(input.argv ?? process.argv.slice(2)),
    env: input.env,
  });
  configureRuntimeContext({
    configNamespace: input.distribution.configNamespace,
    configRoot: selection.root,
    projectConfigEnabled: input.noProjectConfig !== true,
    projectConfigRoot:
      input.noProjectConfig === true
        ? undefined
        : join(
            input.cwd ?? process.cwd(),
            `.${input.distribution.configNamespace}`,
          ),
  });
  return selection;
}

export function parseConfigRootFlag(
  argv: readonly string[],
): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config-root") return argv[i + 1];
    if (arg.startsWith("--config-root="))
      return arg.slice("--config-root=".length);
  }
  return undefined;
}

export function defaultConfigRoot(
  configNamespace: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, configNamespace);
}

function cloneDefaults(
  defaults: IxRuntimeDistribution["defaults"],
): IxRuntimeDistribution["defaults"] {
  if (!defaults) return undefined;
  return Object.fromEntries(
    Object.entries(defaults).map(([pluginId, value]) => [
      pluginId,
      { ...value },
    ]),
  );
}
