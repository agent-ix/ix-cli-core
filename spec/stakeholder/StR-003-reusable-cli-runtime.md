---
id: StR-003
title: "Reusable CLI Runtime"
type: StR
relationships: []
---

## Stakeholder Need

Developers need the IX CLI building blocks to be reusable across multiple CLI
binaries, not only the main `ix` binary.

## Rationale

Tying config, secrets, terminal style, and plugin composition to the single `ix`
binary forces every other CLI author to either fork that binary or re-implement
the same building blocks. Exposing the runtime as a shared library layered on
oclif's native plugin system lets any oclif CLI compose the same capabilities
without a parallel plugin platform, so the main `ix` distribution becomes just one
consumer among many.

## Approach

The reusable runtime is **not** a parallel plugin platform. It is the
combination of:

1. **oclif's native plugin system** for command discovery, dispatch, hooks,
   and topics.
2. **`@agent-ix/ix-cli-core`** — a shared library every IX CLI imports,
   providing `ConfigService`, `SecretsService`, `CapabilityResolver`,
   `BaseCommand`, and the `IxPluginSchema` / `CommandCapabilities` types.
3. **Two conventions** that layer on top of oclif:
   - Each plugin package may export `ixSchema: IxPluginSchema` from its
     main; the host's `init` hook walks oclif's loaded plugin list and
     registers each plugin's config/secrets/env schemas.
   - Commands needing capability guards declare
     `static capabilities = { required, optional }`; `BaseCommand.prerun`
     resolves them before side effects.
4. **A marketplace adapter** over `@agent-ix/ts-plugin-kit` for acquiring
   _data_ plugins (content modules — schemas/skeletons/manifests, not oclif
   commands). ix-cli-core adapts the external library: it wires the cache root
   and bridges resolved sources to oclif's `@oclif/plugin-plugins`. It does
   **not** implement the fetch/pin/registry mechanism itself.

Any oclif CLI can compose this library plus a set of oclif plugins; the
main `ix` distribution is one such CLI.

## Priority

Must-Have

## Validation Criteria


| ID | Criteria | Validation |
|----|----------|------------|
| StR-003-VC-1 | **StR-003-AC-1**: A generic CLI can depend on `@agent-ix/ix-cli-core`, declare its plugin set in `oclif.plugins`, and ship without depending on any IX service. | Demonstration |
| StR-003-VC-2 | **StR-003-AC-2**: An IX-connected CLI uses the same library plus IX service client plugins; no separate runtime exists. | Demonstration |
| StR-003-VC-3 | **StR-003-AC-3**: The main `ix` CLI is an oclif binary whose `oclif.plugins` lists the official Agent IX plugin packages. | Demonstration |
| StR-003-VC-4 | **StR-003-AC-4**: Plugin config, secrets, and env bindings are exposed through the `ixSchema` named export convention and registered by the host's `init` hook. | Inspection |
| StR-003-VC-5 | **StR-003-AC-5**: Per-command capability requirements are declared as a static field on the command class and enforced by `BaseCommand.prerun`. | Inspection |
| StR-003-VC-6 | **StR-003-AC-6**: ix-cli-core exposes a thin adapter over `@agent-ix/ts-plugin-kit` (`marketplaceInstallOptions`, `reconcileDefaultSet`, `resolveOclifPluginInstall`) for acquiring data plugins and bridging them to oclif; the fetch/pin/registry mechanism lives in the leaf library, not in ix-cli-core (see [FR-019](../functional/FR-019-marketplace-adapter.md)). | Demonstration |

## Non-goals

- Per-project enable/disable of plugins via an on-disk manifest. Active
  plugins are declared in the binary's `oclif.plugins` config (or installed
  via `@oclif/plugin-plugins`). Users who want a different plugin set
  ship a different binary.
- A bespoke, hand-rolled plugin registry, distribution object, or manifest
  loader **inside ix-cli-core**, and any argv preprocessing layer. Source
  fetching, pinning, and the install registry live in the external
  `@agent-ix/ts-plugin-kit` library; ix-cli-core only adapts it (Approach 4,
  [FR-019](../functional/FR-019-marketplace-adapter.md)). The earlier in-tree reimplementation of oclif's command discovery
  remains superseded by the oclif-native composition described above.
