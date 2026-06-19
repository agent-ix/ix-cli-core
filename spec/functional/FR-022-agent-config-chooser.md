---
id: FR-022
title: "Preferred-Agent Config and Interactive Chooser"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-003"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-021"
    type: "required-by"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-core` SHALL own a config namespace for the agent-bootstrap
feature and a typed accessor that resolves it for [FR-021](./FR-021-bootstrap-into-agent.md):

```typescript
const AGENT_PLUGIN_ID = "agent";
function agentConfig(): PluginConfig<AgentConfig>;
function maybeBootstrapAgent(seed: string, deps?: BootstrapDeps): boolean;
```

**Dedicated namespace (not `core`).** The settings live under the
framework-owned plugin id `agent` (`config.d/agent.yaml`), reached via
`ix config get/set agent.<key>`. This is deliberately **not** the reserved
`core` id: per §2.2 / §8.1 the `core` schema is owned by the consuming binary,
so a framework-owned `core` registration would contradict that scope and collide
(first-wins) with the host's own `core` registration. A single shared `agent`
schema reference is registered identically across every IX CLI.

**Schema.** A Zod `.strict()` object:

- `preferredAgent?: string` (min length 1) — a bare binary (`claude`) or a
  command (`claude --model opus`). Unset → the chooser runs.
- `autoLaunch: "off" | "prompt" | "auto"` — default **`prompt`**.

**Env bindings.** `IX_PREFERRED_AGENT` → `preferredAgent`,
`IX_AUTO_LAUNCH_AGENT` → `autoLaunch`, layered env → file → default per
[FR-003](./FR-003-layered-resolution.md). An invalid `autoLaunch` value falls
back to the default and records a `schema` incident (it never throws).

**Interactive chooser.** When `preferredAgent` is unset and the caller is an
interactive human, the bootstrap SHALL present a chooser offering the common
agents (`COMMON_AGENTS = ["claude", "codex"]`) plus an **"other → enter a
command"** option and a cancel. A chosen command launches; cancelling is a
no-op. After a pick the user is offered to persist it to `agent.preferredAgent`
(best-effort; declining still launches).

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                 | Verification |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-022-AC-1 | A fresh `agentConfig().get()` returns `{ autoLaunch: "prompt" }` with `preferredAgent` undefined; a file value beats the default.                        | Test         |
| FR-022-AC-2 | `IX_PREFERRED_AGENT` overrides the file value; an invalid `IX_AUTO_LAUNCH_AGENT` falls back to `prompt` and records a `schema` incident on `autoLaunch`. | Test         |
| FR-022-AC-3 | With no configured agent, the chooser's pick (common agent or custom command) is the command that gets launched.                                         | Test         |
| FR-022-AC-4 | A chooser pick is persisted to `agent.preferredAgent` when the save step is accepted; a declined save still launches.                                    | Test         |
| FR-022-AC-5 | A cancelled chooser is a no-op (returns `false`, spawns nothing).                                                                                        | Test         |
| FR-022-AC-6 | The strict schema rejects unknown keys on `set`.                                                                                                         | Test         |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [FR-001](./FR-001-config-service-api.md) (requires), [FR-003](./FR-003-layered-resolution.md) (requires)
- **Downstream**: [FR-021](./FR-021-bootstrap-into-agent.md) (required-by)

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (`src/runtime/agent-config.ts`).
Reads/writes the framework-owned `agent` plugin config through `ConfigService`.

| Symbol                | Signature                                         | Returns  | Description                                                     |
| --------------------- | ------------------------------------------------- | -------- | --------------------------------------------------------------- |
| `agentConfig`         | `() => PluginConfig<AgentConfig>`                 | accessor | Typed `agent`-namespace config; registers the schema on call.   |
| `maybeBootstrapAgent` | `(seed: string, deps?: BootstrapDeps) => boolean` | boolean  | Resolves mode/agent from config and calls `bootstrapIntoAgent`. |
| `AgentSchema`         | `ZodObject (strict)`                              | schema   | `{ preferredAgent?, autoLaunch }`.                              |
| `AGENT_PLUGIN_ID`     | `"agent"`                                         | const    | The framework-owned config namespace id.                        |
| `COMMON_AGENTS`       | `readonly ["claude","codex"]`                     | const    | Chooser's offered common agents.                                |
