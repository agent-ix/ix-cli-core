---
id: FR-020
title: "Agent-Context Detection"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-021"
    type: "required_by"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-core` SHALL export pure predicates that classify the
execution context of a CLI process, so an agent-facing CLI can tell whether it
was launched by an agent harness or typed directly by a human:

```typescript
function runningUnderAgent(env?: NodeJS.ProcessEnv): boolean;
function isInteractiveHuman(deps?: BootstrapDeps): boolean;
```

**Agent-marker contract.** `runningUnderAgent` SHALL return `true` when any of
the following environment variables is present with a non-empty value:
`CLAUDECODE`, `AI_AGENT`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, or
the re-entry guard `IX_AGENT_BOOTSTRAPPED`. Presence — not a `1`/`true` literal
— is the signal, because harnesses set descriptive values (e.g.
`AI_AGENT=claude-code_2-1-177_agent`). An empty-string value counts as absent.

**Interactive-human contract.** `isInteractiveHuman` SHALL return `true` only
when all hold: `runningUnderAgent` is `false`; both stdin and stdout are TTYs;
and the opt-out `IX_NO_AUTO_AGENT` is not set to a truthy value (`1`/`true`/
`yes`/`on`). TTY-ness and env are injectable via `deps` for testing.

**Purity.** Both predicates are side-effect-free and never spawn, read files,
or write output. They are the gate every higher-level behavior consults.

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                  | Verification |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-020-AC-1 | `runningUnderAgent` returns `true` when any one of the five markers (incl. `IX_AGENT_BOOTSTRAPPED`) is present, and `false` when none is.                 | Test         |
| FR-020-AC-2 | A non-`1` marker value (e.g. `AI_AGENT=claude-code_2-1-177_agent`) is detected; an empty-string marker value is treated as absent.                        | Test         |
| FR-020-AC-3 | `isInteractiveHuman` is `true` only for both-TTY, no-marker, no-opt-out; it is `false` if either stream is non-TTY, any marker is set, or opt-out is set. | Test         |
| FR-020-AC-4 | `IX_NO_AUTO_AGENT=1` makes `isInteractiveHuman` return `false`; `IX_NO_AUTO_AGENT=0` does not opt out.                                                    | Test         |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements)
- **Downstream**: [FR-021](./FR-021-bootstrap-into-agent.md) (required-by)

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (`src/runtime/agent.ts`).
Pure predicates; no I/O.

| Symbol                | Signature                              | Returns | Description                                                         |
| --------------------- | -------------------------------------- | ------- | ------------------------------------------------------------------- |
| `runningUnderAgent`   | `(env?: NodeJS.ProcessEnv) => boolean` | boolean | True if any agent marker or the re-entry guard is present.          |
| `isInteractiveHuman`  | `(deps?: BootstrapDeps) => boolean`    | boolean | True only for a real human at an interactive terminal, opt-out off. |
| `AGENT_ENV_MARKERS`   | `readonly string[]`                    | const   | The detected harness marker env-var names.                          |
| `BOOTSTRAP_GUARD_ENV` | `"IX_AGENT_BOOTSTRAPPED"`              | const   | Re-entry guard env-var name.                                        |
| `NO_AUTO_AGENT_ENV`   | `"IX_NO_AUTO_AGENT"`                   | const   | Global opt-out env-var name.                                        |
