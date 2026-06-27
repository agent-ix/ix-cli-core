---
id: FR-024
title: "Update Notifier"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
---

## Description

ix-cli-core SHALL provide a framework-agnostic `maybeOfferUpdate` helper so that
any npm-distributed consuming CLI can notify the user — and offer to install —
when a newer version is published, without re-implementing the throttled
registry check or the prompt. It builds on the same registry query and install
path as [FR-023](./FR-023-self-update-helper.md)'s `runSelfUpdate`.

`maybeOfferUpdate(options)` takes the caller's `packageName`, `currentVersion`,
an optional `registry` override, and injectable `interactive`/`ttlMs`/
`cachePath`/`now`/`env`/`confirm` seams (for host control and tests). It is
designed to **never throw into or block the host CLI**:

- It SHALL skip the check (querying nothing) when running in CI (`env.CI`), when
  opted out (`env.NO_UPDATE_NOTIFIER`), when non-interactive (stdin/stdout not
  both TTYs), or when a prior check falls within the throttle window.
- It SHALL throttle checks with a per-package cache
  (`<cacheRoot>/update-check.json` by default), recording the last-check time and
  latest version, and SHALL record the time even when the query fails so a flaky
  or unreachable registry is not queried on every invocation.
- It SHALL query the latest published version via the FR-023 registry helper
  (honouring the same ambient-config default and scope-specific `registry`
  override), and SHALL swallow any registry/cache failure, returning a skip
  result rather than propagating an error.
- It SHALL treat a version as updatable only when the latest is strictly newer by
  numeric `major.minor.patch` (pre-release/`-dirty` suffixes ignored), so a
  local dev build ahead of the published release is not offered a downgrade.
- When a newer version exists and the session is interactive, it SHALL prompt
  `[Y/n]` (Enter = yes) and, on accept, delegate to `runSelfUpdate` to install.

It returns an `UpdateNotifierResult` (`{ checked, reason?, latest?,
updateAvailable?, updated? }`) for callers that branch on the outcome.

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                | Verification |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-024-AC-1 | The check is skipped (no registry query) in CI, when `NO_UPDATE_NOTIFIER` is set, and when non-interactive, returning the matching `reason`             | Test         |
| FR-024-AC-2 | A prior check within `ttlMs` (seeded cache) is throttled — no registry query — returning `{ checked: false, reason: "throttled" }`                      | Test         |
| FR-024-AC-3 | When a strictly-newer version exists and the user accepts, it delegates to `runSelfUpdate` (install) and returns `updated: true`                        | Test         |
| FR-024-AC-4 | When newer and the user declines, it returns `updateAvailable: true, updated: false` and performs no install                                            | Test         |
| FR-024-AC-5 | An equal version, or a local dev build ahead of the latest, yields `updateAvailable: false` and never prompts                                           | Test         |
| FR-024-AC-6 | A successful or failed check records `lastCheck` in the cache (throttling the next call); a registry failure returns `reason: "error"` without throwing | Test         |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md)
  (reusable CLI runtime — "no bespoke per-CLI re-implementation");
  [FR-023](./FR-023-self-update-helper.md) (registry query + install path reused).
- **Downstream**: consuming CLIs that call `maybeOfferUpdate` early in dispatch
  (e.g. `@agent-ix/quoin`, `@agent-ix/ix-flow`).
