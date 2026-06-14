---
id: US-001
title: "Run Custom CLI Distribution"
artifact_type: US
priority: P1
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## User Story

As a tool author, I want to build a CLI binary using the shared IX CLI
building blocks, so that I can reuse config, secrets, terminal style, and
plugin composition without shipping the full main `ix` plugin bundle.

## Approach

The author creates a normal oclif binary, depends on
`@agent-ix/ix-cli-core`, extends `BaseCommand` for any built-in commands,
and lists the IX plugins they want in their `package.json` `oclif.plugins`
array. The runtime is the library + oclif itself; there is no separate
distribution object or manifest format.

## Acceptance

- **US-001-AC-1**: An oclif CLI depending on `@agent-ix/ix-cli-core` and
  extending `BaseCommand` inherits `--config-root` / `--no-project-config`
  flags and the capability-resolution `prerun` hook.
- **US-001-AC-2**: Plugins listed in the CLI's `oclif.plugins` array load at
  startup via oclif's native discovery. The CLI's `init` hook walks
  `Config.plugins`, reads each plugin's optional `ixSchema` export, and
  registers config/secrets schemas with the shared services.
- **US-001-AC-3**: Given `--config-root`, when a command runs, per-plugin
  config and file-backed secrets resolve from that root through
  `ConfigService.forPlugin(pluginId)`, where `pluginId` is `ixSchema.id`
  or a safe id derived from the package name.
- **US-001-AC-4**: The same plugin package works across any IX CLI binary
  that loads it via `oclif.plugins`; plugin behavior is keyed by package
  install/load identity plus its declared `ixSchema` namespace, not by a
  custom runtime registry.
