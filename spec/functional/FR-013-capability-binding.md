---
id: FR-013
title: "Per-Command Capability Binding"
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

Commands SHALL declare their required and optional capabilities as a
static field on the command class. `BaseCommand.prerun` SHALL resolve
those capabilities through `CapabilityResolver` and short-circuit
commands whose required capabilities are unavailable.

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                                                                                      | Verification |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-013-AC-1 | A command class declares `static capabilities: CommandCapabilities = { required: [...], optional: [...] }` using capability ids from the v1 set: `github`, `ix-api`, `review-service`.                                        | Analysis     |
| FR-013-AC-2 | `BaseCommand.prerun` invokes `CapabilityResolver` against the declared `required` set. If any required capability is unavailable, the command exits with a structured error before side effects occur.                        | Test         |
| FR-013-AC-3 | Optional capabilities that resolve successfully are surfaced through the command context (e.g., `this.hasCapability('github')`) so commands can branch behavior; missing optional capabilities never block command execution. | Test         |
| FR-013-AC-4 | `CapabilityResolver` reads through `ConfigService` and `SecretsService` to determine availability — capability checks share the same per-package namespacing as config and secrets.                                           | Test         |
| FR-013-AC-5 | Capability errors are rendered through the shared CLI UI error primitives and carry a machine-readable error code.                                                                                                            | Test         |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [US-001](../usecase/US-001-run-custom-cli-distribution.md) (implements)

## Errors

- `capability_missing` — capability is not configured at all
- `capability_auth_missing` — capability is declared but its secret is missing
- `capability_config_invalid` — capability's config does not validate

## Notes

The earlier draft specified a custom plugin dispatch consulting a
manifest-level capability map. That has been replaced by a per-command
declaration on the class itself, enforced uniformly through
`BaseCommand.prerun`. The resolver implementation
(`src/runtime/capabilities.ts`) is the same; only its consumer is the
per-command declaration.
