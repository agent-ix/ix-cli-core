---
id: US-002
title: "Human Handoff Into Preferred Agent"
type: US
priority: P2
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-020"
    type: "traces_to"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-021"
    type: "traces_to"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-022"
    type: "traces_to"
    cardinality: "1:1"
---

## Story

As a developer who runs an **agent-facing** IX CLI directly from my shell, I want
the CLI to notice it was meant to be driven by an agent and hand me off into my
preferred agent CLI — already working on what I asked — so that I get the
agent-mediated experience without knowing the incantation, while automated and
agent-internal invocations are never disturbed.

## Approach

The CLI author calls `maybeBootstrapAgent(seed)` (or the lower-level
`bootstrapIntoAgent`) near the top of its entry point, after its `--version` /
`--help` early-returns and before dispatch, building `seed` from the original
argv. The framework:

1. Detects whether this is a real interactive human vs an agent/automation
   ([FR-020](../functional/FR-020-agent-context-detection.md)); only humans are
   handed off.
2. Resolves the preferred agent and launch mode from the framework-owned `agent`
   config, or runs the interactive chooser when none is set
   ([FR-022](../functional/FR-022-agent-config-chooser.md)).
3. Launches the agent interactively, seeded with the request, guarding against
   re-entry ([FR-021](../functional/FR-021-bootstrap-into-agent.md)).

The default mode is `prompt`, so the first time it happens the human confirms
rather than being surprised. `ix config set agent.autoLaunch auto` makes it
silent; `agent.autoLaunch off` or `IX_NO_AUTO_AGENT=1` disables it.

## Acceptance

- **US-002-AC-1**: A human running an agent-facing CLI in an interactive terminal
  with no agent markers is offered (prompt mode) or taken (auto mode) into the
  configured agent, seeded with their request.
- **US-002-AC-2**: The same CLI invoked by an agent harness, in a pipe, or in CI
  runs its normal command and is never handed off
  ([FR-020](../functional/FR-020-agent-context-detection.md),
  [NFR-007](../non-functional/NFR-007-safe-bootstrap-boundaries.md)).
- **US-002-AC-3**: With no preferred agent configured, the human is shown a
  chooser (common agents + custom command) and may persist the pick for next time
  ([FR-022](../functional/FR-022-agent-config-chooser.md)).
- **US-002-AC-4**: When the launched agent shells back into the CLI, the re-entry
  guard prevents a second handoff
  ([FR-021](../functional/FR-021-bootstrap-into-agent.md)).
