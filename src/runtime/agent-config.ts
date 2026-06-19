import { z } from "zod";

import { ConfigService, type PluginConfig } from "../config/service.js";
import { bootstrapIntoAgent, type BootstrapDeps } from "./agent.js";

/**
 * Framework-owned config namespace for the agent-bootstrap feature.
 *
 * NOTE: this is deliberately NOT the reserved `core` plugin id. Per spec.md
 * §2.2 / §8.1 the `core` config schema is owned by the consuming binary, not by
 * this library — registering `core` here would contradict that scope and
 * collide (first-wins) with the host's own `core` registration. A dedicated
 * `agent` id is a framework-owned schema reused identically across every IX CLI
 * (a single shared schema reference, so reads never trip strict-mode on keys an
 * unrelated binary wrote). Reached via `ix config get/set agent.<key>`.
 */
export const AGENT_PLUGIN_ID = "agent";

export const AgentSchema = z
  .object({
    /** Launch command: a bare binary (`claude`) or a command (`claude --model x`).
     * Unset → the interactive chooser runs. */
    preferredAgent: z.string().min(1).optional(),
    /** Default behavior when a human runs an agent-facing CLI directly. */
    autoLaunch: z.enum(["off", "prompt", "auto"]).default("prompt"),
  })
  .strict();

export const AGENT_ENV_BINDINGS = {
  preferredAgent: "IX_PREFERRED_AGENT",
  autoLaunch: "IX_AUTO_LAUNCH_AGENT",
} as const;

export type AgentConfig = z.infer<typeof AgentSchema>;

/**
 * Typed accessor for the framework-owned `agent` config. Calling this also
 * registers the schema, so `ix config get/set agent.*` resolves it. Always
 * reuses the module-level `AgentSchema` reference → idempotent registration.
 */
export function agentConfig(): PluginConfig<AgentConfig> {
  return ConfigService.forPlugin(AGENT_PLUGIN_ID, AgentSchema, {
    envBindings: AGENT_ENV_BINDINGS,
  });
}

/**
 * Convenience for consumers: resolve mode/agent from the `agent` config and
 * bootstrap. Build the `seed` from the original argv. Returns false (caller
 * proceeds) when no launch happens; otherwise the process exits. `deps` is a
 * test seam — production callers omit it.
 */
export function maybeBootstrapAgent(
  seed: string,
  deps?: BootstrapDeps,
): boolean {
  const cfg = agentConfig();
  const v = cfg.get();
  return bootstrapIntoAgent({
    seed,
    mode: v.autoLaunch,
    agent: v.preferredAgent,
    persist: (command) => cfg.set({ preferredAgent: command }),
    deps,
  });
}
