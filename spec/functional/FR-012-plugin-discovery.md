---
id: FR-012
title: "Plugin Discovery"
type: FR
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

## Description

Plugin discovery SHALL use oclif's native plugin system. The set of active
plugins for a CLI binary is declared in the binary's `package.json`
`oclif.plugins` array, with `@oclif/plugin-plugins` available for
user-installable plugins.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-012-AC-1 | A CLI binary's active plugin set is the union of `oclif.plugins` (built-in for the distribution) and any plugins the user has installed via `@oclif/plugin-plugins`. | Test |
| FR-012-AC-2 | No on-disk plugin manifest (`plugins.yaml`) is loaded by the runtime. | Test |
| FR-012-AC-3 | Per-project enable/disable of plugins is not supported. Users who want a different plugin set ship or install a different binary. | Test |
| FR-012-AC-4 | Plugin load failures are surfaced by oclif's normal error path; the IX runtime does not add a separate isolation layer. | Test |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements), [US-001](../usecase/US-001-run-custom-cli-distribution.md) (implements), [FR-010](./FR-010-cli-binary-composition.md) (requires)

## Notes

The original requirement was motivated by per-project plugin enable/disable.
That feature was dropped as not actually required. With it gone, the
chicken-and-egg between config-root resolution and plugin discovery
dissolves (see [FR-011](./FR-011-runtime-config-root.md) notes), so the manifest loader and merge logic are
no longer needed.

This supersession applies to **command** plugins (packages that add oclif
commands) — those are discovered oclif-natively. It does **not** cover **data**
plugins (content modules: schemas/skeletons/manifests consumed by tools such as
quire). Acquiring and pinning those is provided by the marketplace adapter over
`@agent-ix/ts-plugin-kit` (see [FR-019](./FR-019-marketplace-adapter.md)), which is not an in-tree manifest loader.
