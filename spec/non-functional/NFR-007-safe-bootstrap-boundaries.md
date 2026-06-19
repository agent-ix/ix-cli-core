---
id: NFR-007
title: "Safe Agent-Bootstrap Boundaries"
type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-020"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-021"
    type: "requires"
    cardinality: "1:1"
---

## Statement

The agent-bootstrap mechanism ([FR-021](../functional/FR-021-bootstrap-into-agent.md))
SHALL never hand off into an agent in a context where doing so would break
automation or recurse. Specifically it MUST NOT launch when any of the following
holds:

1. **Non-interactive** — stdin or stdout is not a TTY (pipes, redirects, CI,
   cron, git hooks, `< /dev/null`).
2. **Already under an agent** — any agent marker
   (`CLAUDECODE` / `AI_AGENT` / `CODEX_SANDBOX*`) is present.
3. **Re-entry** — the guard `IX_AGENT_BOOTSTRAPPED` is set (the launched agent
   shelled back into the CLI).
4. **Opted out** — `IX_NO_AUTO_AGENT` is truthy, or `agent.autoLaunch` is
   `"off"`.

A failed launch (e.g. binary not found) SHALL be non-fatal: the original command
proceeds. The mechanism MUST NOT spawn through a shell, so a free-text seed
cannot be interpreted as shell syntax.

## Rationale

Auto-launching an interactive agent in a pipe, a CI job, or inside another agent
would corrupt output, hang non-interactive runs, or fork-bomb. The TTY check,
the marker/guard checks, and the explicit opt-outs are the boundary that keeps
the convenience safe; the no-shell rule keeps the seed from becoming an
injection vector.

## Measurement and Evaluation

| Metric                                                           | Target | Threshold | Method                          |
| ---------------------------------------------------------------- | ------ | --------- | ------------------------------- |
| Launches in a non-TTY context                                    | 0      | 0         | Test (NFR-007-AC-1)             |
| Launches while an agent marker / guard is present                | 0      | 0         | Test (NFR-007-AC-2)             |
| Launches while opted out (`IX_NO_AUTO_AGENT` / `autoLaunch=off`) | 0      | 0         | Test (NFR-007-AC-3)             |
| Process aborts caused by a failed agent launch                   | 0      | 0         | Test (NFR-007-AC-4)             |
| Shell invocations in the launch path (`src/runtime/agent.ts`)    | 0      | 0         | Analysis (static, NFR-007-AC-5) |

## Acceptance Criteria

- **NFR-007-AC-1**: With either stream non-TTY, `bootstrapIntoAgent` spawns
  nothing and returns `false`.
- **NFR-007-AC-2**: With any agent marker or `IX_AGENT_BOOTSTRAPPED` set,
  `bootstrapIntoAgent` spawns nothing (cross-checked by
  [FR-021-AC-3](../functional/FR-021-bootstrap-into-agent.md)).
- **NFR-007-AC-3**: With `IX_NO_AUTO_AGENT` truthy or `mode === "off"`,
  `bootstrapIntoAgent` spawns nothing.
- **NFR-007-AC-4**: A spawn `ENOENT` leaves the process alive (no `exit`),
  returns `false`, and logs a hint (cross-checked by
  [FR-021-AC-8](../functional/FR-021-bootstrap-into-agent.md)).
- **NFR-007-AC-5**: A static read of `src/runtime/agent.ts` finds the launch uses
  `spawnSync` with an argv array and never `shell: true` / a shell string.

## Verification

- Unit tests drive `bootstrapIntoAgent` through injected `deps` doubles for every
  boundary (non-TTY, marker, guard, opt-out, ENOENT) and assert zero spawns /
  zero exits.
- A static check asserts the no-shell launch shape.
