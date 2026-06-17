---
id: FR-011
title: "Runtime Config Root Override"
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

`BaseCommand` SHALL expose `--config-root <dir>` as a base flag inherited
by every command, with `IX_CONFIG_ROOT` as its environment-variable
alias. The selected config root applies to per-plugin config reads and
file-backed secrets at command-run time.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-011-AC-1 | Every command extending `BaseCommand` accepts `--config-root <dir>` as a base flag and lists it in `--help`. | Test |
| FR-011-AC-2 | Every such command honors `IX_CONFIG_ROOT` as the env-var alias. | Test |
| FR-011-AC-3 | `--config-root` wins over `IX_CONFIG_ROOT`; the env variable wins over the XDG default (`~/.config/<bin>`). | Test |
| FR-011-AC-4 | The selected config root applies to user config files (`<root>/config.yaml`, `<root>/config.d/<package>.yaml`) and to file-backed secrets (`<root>/secrets/<package>.age`). | Test |
| FR-011-AC-5 | `--no-project-config` disables project config layering (`./.ix/config.yaml`). Default behavior layers project config above user config. | Test |
| FR-011-AC-6 | A missing config root is created lazily only by write commands. Read commands operate from schema defaults without side-effecting the filesystem. | Test |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [US-001](../usecase/US-001-run-custom-cli-distribution.md) (implements)

## Precedence

```text
flags > env > project config (./.ix) > selected user config root > schema defaults
```

## Notes

`--config-root` is a normal oclif base flag, parsed by oclif's flag
system through `BaseCommand.baseFlags`. It is accepted in the normal
oclif command flag position (for example
`<bin> config get --config-root /tmp/ix-ci logLevel`). There is no argv
preprocessing in the bin script and no synthesized runtime argv; the
root-position form `<bin> --config-root /tmp/ix-ci ...` is intentionally
unsupported unless oclif adds native support for that placement.

An earlier draft stripped `--config-root` from `process.argv` before
oclif loaded, on the theory that the config root had to be resolved
before plugin discovery. That constraint was self-imposed (oclif plugin
discovery does not need the config root; only per-plugin config reads
do, and those happen at command-run time when oclif has already parsed
flags). The bypass has been superseded.
