---
id: FR-012
title: "Plugin Discovery"
artifact_type: FR
status: superseded
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/usecase/US-001"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-010"
    type: "requires"
    cardinality: "1:1"
---

> **Status: superseded.** The original requirement required loading enabled
> plugins from distribution defaults plus on-disk user and project plugin
> manifests. That requirement has been retired in favor of oclif-native
> discovery described below.

## Behavior

Plugin discovery SHALL use oclif's native plugin system. The set of active
plugins for a CLI binary is declared in the binary's `package.json`
`oclif.plugins` array, with `@oclif/plugin-plugins` available for
user-installable plugins.

## Acceptance

- **FR-012-AC-1**: A CLI binary's active plugin set is the union of
  `oclif.plugins` (built-in for the distribution) and any plugins the
  user has installed via `@oclif/plugin-plugins`.
- **FR-012-AC-2**: No on-disk plugin manifest (`plugins.yaml`) is loaded by
  the runtime.
- **FR-012-AC-3**: Per-project enable/disable of plugins is not supported.
  Users who want a different plugin set ship or install a different
  binary.
- **FR-012-AC-4**: Plugin load failures are surfaced by oclif's normal error
  path; the IX runtime does not add a separate isolation layer.

## Notes

The original requirement was motivated by per-project plugin enable/disable.
That feature was dropped as not actually required. With it gone, the
chicken-and-egg between config-root resolution and plugin discovery
dissolves (see FR-011 notes), so the manifest loader and merge logic are
no longer needed.
