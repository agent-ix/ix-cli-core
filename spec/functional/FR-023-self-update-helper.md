---
id: FR-023
title: "Self-Update Helper"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## Description

ix-cli-core SHALL provide a framework-agnostic `runSelfUpdate` helper so that
any npm-distributed consuming CLI can offer an `update`/install-latest command
without re-implementing the registry query, version comparison, and global
install. The helper has no oclif dependency and is callable from a plain command
dispatcher as readily as from a `BaseCommand`.

`runSelfUpdate(options)` takes the caller's `packageName`, `currentVersion`, an
optional listing `header`, an optional `registry` override, and a `check` flag.
It:

- queries the latest published version with `npm view <packageName> version`;
- when the running version already equals the latest, reports up-to-date and
  installs nothing;
- under `check`, reports whether an update is available and installs nothing;
- otherwise runs `npm install -g <packageName>@<latest>` (inherited stdio so npm
  draws its own progress).

Registry resolution SHALL default to the **ambient npm config** — i.e. however
the caller was installed (its `@scope:registry`, or the npm default) — rather
than a hardcoded registry. When a `registry` override is supplied, it SHALL be
applied as the **scope-specific** `--<scope>:registry=<url>` flag for a scoped
package (a plain `--registry` is silently ignored for a scoped package when an
npmrc pins a `@scope:registry`), and as a plain `--registry <url>` for an
unscoped package.

The helper renders its result through `@agent-ix/ix-ui-cli` (the same
`Listing`/`FlowLine`/`Note` surface as the other command runners) so every
consuming CLI gets identical output, and also returns a `SelfUpdateResult`
(`{ updated, latest }`) for callers that branch on the outcome.

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                                                                          | Verification |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-023-AC-1 | When the running version equals the registry's latest, `runSelfUpdate` reports up-to-date, performs no install, and returns `{ updated: false, latest }`                                                          | Test         |
| FR-023-AC-2 | With `check: true` and a newer latest available, it reports the available update, performs no install, and returns `{ updated: false, latest }`                                                                   | Test         |
| FR-023-AC-3 | When out of date and `check` is unset, it runs `npm install -g <packageName>@<latest>` and returns `{ updated: true, latest }`                                                                                    | Test         |
| FR-023-AC-4 | With no `registry` override, no registry flag is passed (ambient config resolves the package); with an override, a scoped package uses `--<scope>:registry=<url>` and an unscoped package uses `--registry <url>` | Test         |
| FR-023-AC-5 | When `npm view` cannot reach the registry, the helper surfaces a failure (rejects) rather than reporting success                                                                                                  | Test         |
| FR-023-AC-6 | The helper imports no oclif API and is invoked from a plain async dispatcher (e.g. quoin's `update`), not only from `BaseCommand`                                                                                 | Inspection   |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md)
  (reusable CLI runtime — "no bespoke per-CLI re-implementation").
- **Downstream**: consuming CLIs that expose an `update` command over this
  helper (e.g. `@agent-ix/quoin`).
