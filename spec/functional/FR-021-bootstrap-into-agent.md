---
id: FR-021
title: "Bootstrap Into Preferred Agent"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-020"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-022"
    type: "requires"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-core` SHALL export a launcher that, when a human runs an
agent-facing CLI directly, hands off into the human's preferred agent CLI seeded
with their request:

```typescript
function bootstrapIntoAgent(opts: BootstrapOptions): boolean;
```

**Gating.** `bootstrapIntoAgent` SHALL be a no-op returning `false` (so the
caller proceeds with its own command) when `opts.mode === "off"`, when
[`isInteractiveHuman`](./FR-020-agent-context-detection.md) is false, or when an
agent-marker/​guard is set. Returning `false` means "I did nothing."

**Launch.** Otherwise it SHALL run the resolved agent command via a synchronous,
stdio-inherited child process (`spawnSync(bin, [...args, seed], { stdio: "inherit", env })`)
seeded with `opts.seed` as the **final** positional argument, then exit with the
child's status. The command is parsed into argv by whitespace split — **no
shell** — so a free-text seed cannot inject. Inheriting stdio hands the agent
the controlling TTY (interactive session, Ctrl-C and exit-code passthrough).

**Re-entry guard.** The child environment SHALL carry
`IX_AGENT_BOOTSTRAPPED=1`, so when the launched agent shells back into the same
CLI, [FR-020](./FR-020-agent-context-detection.md) short-circuits and no second
launch occurs (fork-bomb prevention).

**Prompt vs auto.** When `mode === "prompt"` and an agent is configured, the
launcher SHALL confirm (`[Y/n]`, default yes) before launching; when
`mode === "auto"` it launches without confirmation. When no agent is configured
it defers to the chooser ([FR-022](./FR-022-agent-config-chooser.md)).

**Non-fatal failure.** A spawn that fails to start (e.g. `ENOENT`) SHALL NOT
throw or exit; it logs a one-line hint and returns `false` so the original
command still runs. A child that dies by signal (null status) maps to exit `0`.

## Acceptance Criteria

| ID          | Criteria                                                                                                                                 | Verification |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-021-AC-1 | `mode === "off"` returns `false` and spawns nothing.                                                                                     | Test         |
| FR-021-AC-2 | When not an interactive human (non-TTY), returns `false` and spawns nothing.                                                             | Test         |
| FR-021-AC-3 | When an agent marker is set in env, returns `false` and spawns nothing (re-entry/fork-bomb guard).                                       | Test         |
| FR-021-AC-4 | `auto` mode spawns the agent with `stdio:"inherit"`, the seed as the final argv element, and `IX_AGENT_BOOTSTRAPPED=1` in the child env. | Test         |
| FR-021-AC-5 | A multi-word command (`"claude --model opus"`) is split into `bin`+args with the seed appended last; no shell is used.                   | Test         |
| FR-021-AC-6 | `prompt` mode launches only when the confirm is accepted; a declined confirm spawns nothing.                                             | Test         |
| FR-021-AC-7 | The child's exit status is forwarded (`3 → exit(3)`); a null status (signal death) maps to `exit(0)`.                                    | Test         |
| FR-021-AC-8 | A spawn `ENOENT` is non-fatal: returns `false`, does not exit, and logs a "continuing without it" hint.                                  | Test         |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [FR-020](./FR-020-agent-context-detection.md) (requires), [FR-022](./FR-022-agent-config-chooser.md) (requires)

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (`src/runtime/agent.ts`).
Spawns a synchronous, stdio-inherited child and forwards its exit status.

| Symbol               | Signature                                 | Returns | Description                                                                        |
| -------------------- | ----------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `bootstrapIntoAgent` | `(opts: BootstrapOptions) => boolean`     | boolean | Launches the agent (process exits) or returns `false` to fall through.             |
| `BootstrapOptions`   | `{ seed; mode; agent?; persist?; deps? }` | type    | `seed` is the prompt; `mode`/`agent` are resolved policy; `deps` is the test seam. |
| `splitAgentCommand`  | `(command: string) => string[]`           | argv    | Whitespace-splits a launch command (no shell).                                     |
