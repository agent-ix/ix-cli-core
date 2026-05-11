import type { ConfigService } from "../config/service.js";
import type { SecretsService } from "../secrets/service.js";
import type {
  BuiltInCapabilityId,
  CommandCapabilities,
} from "./capability-spec.js";

export type { BuiltInCapabilityId, CommandCapabilities };

export type CapabilityErrorKind =
  | "capability_missing"
  | "capability_auth_missing"
  | "capability_config_invalid";

export interface CapabilityError {
  kind: CapabilityErrorKind;
  capabilityId: string;
  packageName?: string;
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

export interface CapabilityResolverInput {
  capabilities: CommandCapabilities;
  packageName?: string;
  commandId?: string;
}

export interface CapabilityResolver {
  resolveCommand(
    input: CapabilityResolverInput,
  ): Promise<
    | { ok: true; availableCapabilities: string[] }
    | { ok: false; errors: CapabilityError[]; availableCapabilities: string[] }
  >;
}

/**
 * Build a resolver that consults `providers` for each required and
 * optional capability declared on a command class
 * (`static capabilities: CommandCapabilities`). Required capabilities
 * that fail produce structured errors; optional capabilities never
 * block resolution but are surfaced so commands can branch.
 */
export function createCapabilityResolver(input: {
  config: typeof ConfigService;
  secrets: SecretsService;
  providers: Record<string, CapabilityProvider>;
}): CapabilityResolver {
  return {
    async resolveCommand({ capabilities, packageName, commandId }) {
      const errors: CapabilityError[] = [];
      const availableCapabilities: string[] = [];
      for (const capabilityId of capabilities.required ?? []) {
        const provider = input.providers[capabilityId];
        if (!provider) {
          errors.push({
            kind: "capability_missing",
            capabilityId,
            packageName,
            commandId,
            detail: `capability ${capabilityId} is not available`,
          });
          continue;
        }
        const result = await provider(capabilityId, {
          config: input.config,
          secrets: input.secrets,
        });
        if (result !== true) {
          errors.push({ ...result, capabilityId, packageName, commandId });
        } else {
          availableCapabilities.push(capabilityId);
        }
      }
      for (const capabilityId of capabilities.optional ?? []) {
        const provider = input.providers[capabilityId];
        if (!provider) continue;
        const result = await provider(capabilityId, {
          config: input.config,
          secrets: input.secrets,
        });
        if (result === true) {
          availableCapabilities.push(capabilityId);
        }
      }
      return errors.length === 0
        ? { ok: true, availableCapabilities }
        : { ok: false, errors, availableCapabilities };
    },
  };
}

export function capabilityErrorToJson(error: CapabilityError): {
  code: CapabilityErrorKind;
  capabilityId: string;
  packageName?: string;
  commandId?: string;
  detail: string;
} {
  return {
    code: error.kind,
    capabilityId: error.capabilityId,
    packageName: error.packageName,
    commandId: error.commandId,
    detail: error.detail,
  };
}
