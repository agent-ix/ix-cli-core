---
id: FR-025
title: "oclif Runner and Core-Plugin Host"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## Description

ix-cli-core SHALL provide the oclif entry points a consuming CLI needs to run,
so that a binary composed per [FR-010](./FR-010-cli-binary-composition.md) ships
a thin `bin` script rather than re-deriving oclif wiring. The runner is a
wrapper over `@oclif/core`: command discovery and core-plugin discovery are
performed by oclif's own `Config` loader, and ix-cli-core adds no registry,
manifest loader, or plugin resolution of its own.

`run(argv?, options?)` loads the consuming CLI's `Config` from `options` and
dispatches the requested command, returning the command's result. It SHALL
throw on error rather than calling `process.exit`, so it is safe to drive from
a test. `argv` SHALL default to `process.argv.slice(2)`.

`execute(options)` is the load-and-run entry point for a top-level bin: it
loads the config, runs the command, flushes output, and owns error handling and
the process exit code.

`loadConfig(options?)` SHALL expose the resolved plugin and command graph
without dispatching, so a CLI or a test can introspect what oclif discovered.
The returned `Config` SHALL be accepted back by `run` as its `options`, so a
caller resolves the graph at most once.

`listCorePlugins(config)` SHALL report the core plugins loaded into a config —
those the host declared in `oclif.plugins` and oclif resolved from its
dependencies — excluding the root host plugin itself, for diagnostics and for
asserting plugin-host wiring.

Only **bundled** core plugins are in scope. ix-cli-core SHALL NOT import
`@oclif/plugin-plugins`; runtime, user-installed plugins are out of scope.

A `BaseCommand` subclass contributed by either the host or a core plugin SHALL
run unchanged through the runner: its base flags (`--config-root`,
`--no-project-config`) and its capability resolution
([FR-013](./FR-013-per-command-capability-binding.md)) are wired through the
oclif lifecycle, so a command whose required capability is unavailable is
short-circuited before its `run` body executes.

## Acceptance Criteria

| ID          | Criteria                                                                                                                | Verification |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-025-AC-1 | A loaded config exposes both the host's own commands and the commands contributed by a declared core plugin             | Test         |
| FR-025-AC-2 | A host `BaseCommand` subclass runs end-to-end through the runner with its base flags parsed                             | Test         |
| FR-025-AC-3 | A command contributed by a core plugin runs through the runner                                                          | Test         |
| FR-025-AC-4 | A command whose required capability is unavailable is short-circuited before its `run` body executes                    | Test         |
| FR-025-AC-5 | `run` rejects on a command error rather than calling `process.exit`, so a caller or test observes the failure           | Test         |
| FR-025-AC-6 | A `Config` obtained from `loadConfig` is accepted by `run` as its `options`, dispatching without re-resolving the graph | Test         |
| FR-025-AC-7 | `listCorePlugins` reports declared core plugins and excludes the root host plugin                                       | Test         |
| FR-025-AC-8 | ix-cli-core declares no dependency on `@oclif/plugin-plugins`                                                           | Inspection   |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md)
  (reusable CLI runtime — "no bespoke per-CLI re-implementation").
  Consumes [FR-013](./FR-013-per-command-capability-binding.md) for the
  capability wiring the runner inherits.
- **Downstream**: [FR-010](./FR-010-cli-binary-composition.md) — a binary
  composed per FR-010 runs on this runner; consuming CLIs (e.g.
  `@agent-ix/quoin`) depend on `run` / `loadConfig` being exported.
