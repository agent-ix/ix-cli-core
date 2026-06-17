---
id: FR-019
title: "Marketplace Adapter"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-011"
    type: "requires"
    cardinality: "1:1"
---

## Description

ix-cli-core SHALL provide a thin adapter over the external
`@agent-ix/ts-plugin-kit` library so that any consuming CLI can acquire **data**
plugins (content modules — schemas/skeletons/manifests, not oclif commands) and
bridge **command** plugins into oclif. The adapter wires the leaf library's
inputs from ix-cli-core's existing runtime/config layout; it does not implement
source fetching, pinning, or the install registry — those live in the leaf
library.

The adapter exposes:

- `marketplaceInstallOptions(target)` — build `@agent-ix/ts-plugin-kit`
  install options whose cache root is derived from {@link cacheRoot}
  (`<cache>/ts-plugin-kit`); the host supplies the target dir, registry path,
  `readName`, and materialize mode.
- `reconcileDefaultSet(manifest, target, mode?)` — reconcile a marketplace
  manifest's default set into the host's target dir (delegates to the leaf
  library's `reconcile`).
- `resolveOclifPluginInstall(source, opts?)` — map a typed source to an oclif
  command-plugin instruction: `{ kind: "install", spec }` for an `npm` source
  (no fetch), or `{ kind: "link", localPath }` for a fetched-and-pinned source.
  The host dispatches this to `@oclif/plugin-plugins`.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-019-AC-1 | `marketplaceInstallOptions` returns options whose `cacheRoot` is `<ix-cli-core cacheRoot()>/ts-plugin-kit` and that carry through the host-supplied target dir, registry path, `readName`, and materialize mode. | Test |
| FR-019-AC-2 | `reconcileDefaultSet` reconciles a manifest's enabled entries into the target dir and returns the leaf library's installed/unchanged/updated/skipped result. | Test |
| FR-019-AC-3 | `resolveOclifPluginInstall` returns `{ kind: "install" }` with an npm spec (including `@version` when present) for an `npm` source, and `{ kind: "link" }` with the resolved local path for every other (non-`npm`) source type — `github`, `git-subdir`, `git`, `url`, and `path` are all fetched + pinned by the leaf library and linked. | Test |
| FR-019-AC-4 | ix-cli-core does not import `@oclif/plugin-plugins` and does not implement source fetching, pinning, or an install registry in its own `src/`; those are delegated to `@agent-ix/ts-plugin-kit`. | Test |

## Dependencies

- **Upstream**: StR-003 (implements), FR-011 (requires)

## Notes

This requirement replaces the part of FR-012's supersession that left **data**
plugin acquisition unaddressed. Command-plugin discovery remains oclif-native
(FR-012); FR-019 adds the data-plugin acquisition + oclif install bridge as a
thin adapter, keeping StR-003's "no bespoke installer in ix-cli-core" intent.
