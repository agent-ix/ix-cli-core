import { Command, Flags } from "@oclif/core";
import { join } from "node:path";

import { ConfigService } from "../config/service.js";
import { defaultSecretsService } from "../secrets/default.js";
import {
  capabilityErrorToJson,
  createCapabilityResolver,
} from "../runtime/capabilities.js";
import { configureRuntimeContext } from "../runtime/context.js";
import type { CommandCapabilities } from "../runtime/capability-spec.js";

/**
 * Base class for every command in any IX CLI binary.
 *
 * - Owns `--config-root` and `--no-project-config` as oclif base flags
 *   (parsed natively by oclif — no argv preprocessing in the bin
 *   script). Their values are read in `init()` and pushed into the
 *   runtime context that backs `ConfigService` and `SecretsService`.
 * - Reserves a static `capabilities` field for subclasses to declare
 *   their required and optional capabilities. `BaseCommand.prerun`
 *   short-circuits the command when a required capability is unavailable.
 *
 * Per FR-021 / FR-022 / FR-024.
 */
export abstract class BaseCommand extends Command {
  static override baseFlags = {
    "config-root": Flags.string({
      description: "Override the user-level config root for this invocation.",
      helpGroup: "GLOBAL",
      env: "IX_CONFIG_ROOT",
    }),
    "no-project-config": Flags.boolean({
      description: "Disable project-local .ix config layering.",
      default: false,
      helpGroup: "GLOBAL",
    }),
  };

  /**
   * Subclasses set this to declare their capability requirements. Read
   * by `prerun()`. See `CommandCapabilities` and FR-024.
   */
  static capabilities?: CommandCapabilities;

  protected readonly availableCapabilities = new Set<string>();

  protected hasCapability(id: string): boolean {
    return this.availableCapabilities.has(id);
  }

  public override async init(): Promise<void> {
    await super.init();
    const configRoot =
      configRootFromArgv(this.argv) ?? process.env.IX_CONFIG_ROOT;
    const noProject = hasFlag(this.argv, "--no-project-config");
    configureRuntimeContext({
      ...(typeof configRoot === "string" && configRoot.length > 0
        ? { configRoot }
        : {}),
      projectConfigRoot: noProject ? undefined : join(process.cwd(), ".ix"),
      projectConfigEnabled: noProject !== true,
    });
  }

  public async prerun(): Promise<void> {
    const ctor = this.constructor as typeof BaseCommand;
    const capabilities = ctor.capabilities;
    if (!capabilities) return;

    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets: defaultSecretsService(),
      providers: {},
    });
    const result = await resolver.resolveCommand({
      capabilities,
      packageName: ctor.pluginName,
      commandId: ctor.id,
    });
    for (const id of result.availableCapabilities) {
      this.availableCapabilities.add(id);
    }
    if (!result.ok) {
      this.error(JSON.stringify(result.errors.map(capabilityErrorToJson)), {
        exit: 1,
      });
    }
  }
}

function configRootFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config-root") return argv[i + 1];
    if (arg.startsWith("--config-root=")) {
      return arg.slice("--config-root=".length);
    }
  }
  return undefined;
}

function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}
