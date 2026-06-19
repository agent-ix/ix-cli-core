---
id: FR-010
title: "CLI Binary Composition"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/usecase/US-001"
    type: "implements"
    cardinality: "1:1"
---

## Description

An IX CLI binary SHALL be a normal oclif application that:

1. Depends on `@agent-ix/ix-cli-core`.
2. Extends `BaseCommand` (from `@agent-ix/ix-cli-core`) for its
   command classes, inheriting the `--config-root` /
   `--no-project-config` base flags and the capability-resolution
   `prerun` hook.
3. Lists its active plugin packages in `package.json` `oclif.plugins`
   (or relies on `@oclif/plugin-plugins` for user-installable plugins).
4. Registers each loaded plugin's `ixSchema` export with the host's
   `init` hook (provided by `@agent-ix/ix-cli-core`).

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                                                      | Verification |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-010-AC-1 | Built-in plugin packages load via oclif's native plugin discovery — no custom registry, no manifest loader.                                                                                   | Test         |
| FR-010-AC-2 | An IX-connected CLI uses the same composition; the difference is only in which plugins it lists.                                                                                              | Test         |
| FR-010-AC-3 | The main `ix` distribution lists the official Agent IX plugin packages (e.g., `@agent-ix/ix-cli-elements`, `@agent-ix/ix-cli-local`, `@agent-ix/workflow-cli-plugin`) in its `oclif.plugins`. | Test         |
| FR-010-AC-4 | Per-binary defaults (binary name, branding, log level defaults) live in the binary's own config and the `core` plugin's schema, not in a separate distribution object.                        | Test         |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [US-001](../usecase/US-001-run-custom-cli-distribution.md) (implements)

## Notes

The main `ix` CLI is not a special engine. It is an oclif binary that
imports the same `@agent-ix/ix-cli-core` library as any other.

There is no `Distribution` runtime object. An earlier draft modeled
distributions as registry entries with explicit `defaultPlugins` and
`branding` fields. That has been superseded by the oclif-native approach
described above.
