---
id: NFR-001
title: "No Plaintext Secret Values Persisted on Disk"
artifact_type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-005"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-007"
    type: "requires"
    cardinality: "1:1"
---

## Statement

No secret value managed by `SecretsService` SHALL be persisted to any file on disk in unencrypted form. The only sanctioned persistence paths are:

1. **OS keyring** (FR-006), where ciphertext is held by the platform credential store (Keychain / libsecret / Credential Manager).
2. **age-encrypted blob** (FR-007) at `<config-root>/secrets.d/<plugin-id>.age`, encrypted with an X25519 identity at `<config-root>/secrets.key`.

This NFR applies to:

- All secrets declared via a plugin's `ixSchema.secrets` and persisted by `SecretsService.set`.
- The persistence channels enumerated in NFR-001-AC-1 (the file-write APIs ix-cli-core code calls). Channels enumerated there are exhaustive for the static-check assertion.

This NFR does NOT govern:

- Environment variables in the user's shell — those are operator-controlled.
- In-memory values during a single CLI process — memory hygiene is best-effort, not absolute (see FR-007 "Memory hygiene").
- Kubernetes Secret manifests or other in-flight material rendered by consumers and applied to external systems — those are not persisted by `@agent-ix/ix-cli-core`.
- Transitively-derived material that consumers compute from secret values _after_ `SecretsService.get(...)` returns. Consumers SHOULD NOT write derivatives to disk; the static check in NFR-001-AC-1 catches the most common patterns but is not a complete proof for arbitrary downstream code. Plugin authors are responsible for not persisting derived material.

## Rationale

Filesystem permissions (`0o600`) alone are not adequate protection: backups, sync clients, container layers, and accidental tarballs routinely promote 0600 files into less-protected contexts. OS keyrings exist precisely to bound that exposure to the running login session. When a keyring is unavailable, age encryption with a per-machine identity preserves the same property: a copied file without the matching identity yields no value.

## Acceptance Criteria

- **NFR-001-AC-1**: A static scan across the library source (`src/`) SHALL find zero call sites where the result of `SecretsService.get(...)`, or any variable directly bound to it, flows into any of the following persistence channels outside `src/secrets/backends/`: `fs.writeFile`, `fs.writeFileSync`, `fs.appendFile`, `fs.appendFileSync`, `fs.createWriteStream`, `fsPromises.writeFile`, `fsPromises.appendFile`, `fsPromises.open(..., 'w'|'a')`, `child_process.spawn(..., { input })`, `child_process.spawnSync(..., { input })`, `child_process.exec(..., { input })`, `process.stdout.write`, `process.stderr.write`, `console.*`. The check is implemented as a typed dataflow grep (variable name + immediate sink) seeded by `SecretsService.get` call sites.
- **NFR-001-AC-2**: A round-trip test SHALL `set` a secret, then read every byte of `<config-root>/secrets.d/<plugin>.age` and `<config-root>/secrets.key`; the plaintext value of the secret SHALL NOT appear as a substring of either file.
- **NFR-001-AC-3**: An integration test SHALL verify that after `secrets set local.ghcr-token`, the only on-disk artifact is either an OS keychain entry (no plaintext file produced) or an age blob whose decryption requires `secrets.key`.

## Verification

- A dedicated security test implements NFR-001-AC-1 and NFR-001-AC-2 as static greps and a round-trip leak scan.
- The integration test from NFR-001-AC-3 runs in CI on Linux (with and without dbus / Secret Service available) to exercise both backend paths.
