---
id: NFR-002
title: "Sensitive Files Created Mode 0600 via Atomic Temp+Rename"
type: NFR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-007"
    type: "requires"
    cardinality: "1:1"
---

## Statement

Any file written by `@agent-ix/ix-cli-core` that contains user configuration or secret material SHALL be created with mode `0o600` and SHALL be replaced atomically via a write-temp + rename pattern, regardless of process umask.

The set of governed files is:

| Path                                           | Owner                           | Contains          |
| ---------------------------------------------- | ------------------------------- | ----------------- |
| `<config-root>/config.yaml`                    | ConfigService (id `core`)       | Core CLI config   |
| `<config-root>/config.d/<plugin-id>.yaml`      | ConfigService                   | Per-plugin config |
| `<config-root>/secrets.key`                    | SecretsService age-file backend | X25519 identity   |
| `<config-root>/secrets.d/<plugin-id>.age`      | SecretsService age-file backend | Encrypted secrets |
| `<config-root>/config.d/<plugin-id>.yaml.lock` | ConfigService                   | Advisory lock     |

**Atomicity contract.**

1. Open temp file with `O_CREAT | O_EXCL | O_WRONLY`, mode `0o600`.
2. Write payload, fsync.
3. `fs.rename(temp, target)` — POSIX-atomic on the same filesystem.
4. On any error before rename, unlink the temp file.

A reader observing `target` SHALL only ever see a complete, valid prior version OR the new version — never a partial write.

**Permission self-defense.** On read, `ConfigService` and `SecretsService` SHALL refuse to load a governed file whose mode is wider than `0o600` and SHALL emit a structured error naming the path and observed mode. The user is told to `chmod 0600 <path>` and re-run. (Symlinks SHALL be rejected outright to prevent permission-laundering.)

## Rationale

A wider mode on `secrets.key` voids [NFR-001](./NFR-001-no-plaintext-secrets.md) — the identity that decrypts every blob would be readable to other local users. Permission self-defense is cheap and prevents a misconfigured backup tool from silently downgrading the trust boundary.

## Measurement and Evaluation

| Metric | Target | Threshold | Method |
|--------|--------|-----------|--------|
| Mode of a governed file created via `ConfigService.set` under `umask 0022` | `0o600` | `0o600` | Test (NFR-002-AC-1) |
| Orphan `*.tmp.*` artifacts left after a failed rename | 0 | 0 | Test (NFR-002-AC-2) |
| Wider-than-`0o600` or symlinked governed files loaded without refusal | 0 | 0 | Test (NFR-002-AC-3, NFR-002-AC-4) |
| Direct `fs.writeFile`/`writeFileSync` writers outside the `atomicWrite` helper | 0 | 0 | Analysis (static grep, NFR-002-AC-5) |

## Acceptance Criteria

- **NFR-002-AC-1**: A test starting with `umask 0022` writes a config via `ConfigService.set`; the resulting file mode is exactly `0o600`.
- **NFR-002-AC-2**: A simulated write failure (mocked `fs.rename` throws) leaves the original target file untouched and removes the temp file; no `*.tmp.*` artifact remains in `<config-root>/config.d/`.
- **NFR-002-AC-3**: Setting `<config-root>/secrets.key` to mode `0o644` (test fixture) causes `SecretsService.get/set/delete` to throw `SecretsIdentityPermissionsError` naming the path and observed mode; no further IO occurs.
- **NFR-002-AC-4**: A symlinked governed file (e.g. `secrets.key -> /tmp/laundered.key`) is rejected on access; the error names the symlink path.
- **NFR-002-AC-5**: A static grep across `src/` SHALL find zero direct `fs.writeFile`/`writeFileSync` calls outside the central `atomicWrite` helper module; all writers MUST go through that helper.

## Verification

- A dedicated permission test implements NFR-002-AC-1, NFR-002-AC-2, NFR-002-AC-4 against a tmpdir.
- A static-check test implements NFR-002-AC-5 by grepping the source tree.
