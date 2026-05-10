import type { ConfigService } from "../config/service.js";
import type { SecretsService } from "../secrets/service.js";
import type { IxCommandRegistration, IxPlugin } from "../plugins/types.js";

export type BuiltInCapabilityId = "github" | "ix-api" | "review-service";

export type CapabilityErrorKind =
  | "capability_missing"
  | "capability_auth_missing"
  | "capability_config_invalid";

export interface CapabilityError {
  kind: CapabilityErrorKind;
  capabilityId: string;
  pluginId: string;
  commandId?: string;
  detail: string;
}

export interface CapabilityProviderContext {
  config: typeof ConfigService;
  secrets: SecretsService;
}

export type CapabilityProvider = (
  capabilityId: string,
  context: CapabilityProviderContext,
) => Promise<true | CapabilityError> | true | CapabilityError;

export interface CapabilityResolver {
  resolveCommand(input: {
    plugin: IxPlugin;
    command?: IxCommandRegistration;
  }): Promise<{ ok: true } | { ok: false; errors: CapabilityError[] }>;
}

export function createCapabilityResolver(input: {
  config: typeof ConfigService;
  secrets: SecretsService;
  providers: Record<string, CapabilityProvider>;
}): CapabilityResolver {
  return {
    async resolveCommand({ plugin, command }) {
      const required = requiredCapabilitiesFor(plugin, command);
      const errors: CapabilityError[] = [];
      for (const capabilityId of required) {
        const provider = input.providers[capabilityId];
        if (!provider) {
          errors.push({
            kind: "capability_missing",
            capabilityId,
            pluginId: plugin.id,
            commandId: command?.id,
            detail: `capability ${capabilityId} is not available`,
          });
          continue;
        }
        const result = await provider(capabilityId, {
          config: input.config,
          secrets: input.secrets,
        });
        if (result !== true) {
          errors.push({
            ...result,
            capabilityId,
            pluginId: plugin.id,
            commandId: command?.id,
          });
        }
      }
      return errors.length === 0 ? { ok: true } : { ok: false, errors };
    },
  };
}

export function requiredCapabilitiesFor(
  plugin: IxPlugin,
  command?: IxCommandRegistration,
): string[] {
  const required = new Set<string>();
  for (const capability of plugin.capabilities ?? []) {
    if (capability.mode === "required") required.add(capability.id);
  }
  for (const capabilityId of command?.requiredCapabilities ?? []) {
    required.add(capabilityId);
  }
  return Array.from(required);
}

export function capabilityErrorToJson(error: CapabilityError): {
  code: CapabilityErrorKind;
  capabilityId: string;
  pluginId: string;
  commandId?: string;
  detail: string;
} {
  return {
    code: error.kind,
    capabilityId: error.capabilityId,
    pluginId: error.pluginId,
    commandId: error.commandId,
    detail: error.detail,
  };
}
