---
type: log
title: "Update Log"
description: "Chronological log of structural changes to this bundle."
---

# Update Log

## History

- **2026-06-15** — Adopted OKF-compatible bundle structure with directory indexes.
- **2026-06-20** — Added [FR-023](./functional/FR-023-self-update-helper.md) (`runSelfUpdate` helper): framework-agnostic self-update for npm-distributed consuming CLIs (npm view → compare → `npm install -g`), rendering via ix-ui-cli and returning a `SelfUpdateResult`. Registry defaults to ambient npm config; an override is applied as the scope-specific `--<scope>:registry=` flag for scoped packages. Consumed by `@agent-ix/quoin`'s `update` command.
