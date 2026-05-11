import { Command, Flags } from "@oclif/core";

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
 *   (added in a follow-up) will short-circuit the command when a
 *   required capability is unavailable.
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

  public override async init(): Promise<void> {
    await super.init();
    // Re-parse just the base flags so we have their values before any
    // command-specific `run()` work begins (oclif parses the full flag
    // set lazily inside run(); we want runtime context configured first).
    const parsed = await this.parse({
      flags: BaseCommand.baseFlags,
      strict: false,
    });
    const flags = parsed.flags as Record<string, unknown>;
    const configRoot = flags["config-root"];
    const noProject = flags["no-project-config"];
    configureRuntimeContext({
      ...(typeof configRoot === "string" && configRoot.length > 0
        ? { configRoot }
        : {}),
      projectConfigEnabled: noProject !== true,
    });
  }
}
