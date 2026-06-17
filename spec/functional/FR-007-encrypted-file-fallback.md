---
id: FR-007
title: "Encrypted-File Fallback for Headless Environments"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-005"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/non-functional/NFR-001"
    type: "requires"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/non-functional/NFR-002"
    type: "requires"
    cardinality: "1:1"
---

## Description

When the keyring capability probe ([FR-006](./FR-006-keyring-backend.md)) fails, `SecretsService` SHALL persist secrets to per-plugin age-encrypted files:

- **Identity file**: `<config-root>/secrets.key` (mode `0o600`). On first use, generated as a fresh X25519 age identity. The file is the symmetric trust root.
- **Per-plugin blobs**: `<config-root>/secrets.d/<pluginId>.age` (mode `0o600`). Each blob is an age-encrypted YAML map of `<secret-name>: <value>` for that plugin.

**Library choice.** Implementation SHALL use the [`age-encryption`](https://www.npmjs.com/package/age-encryption) npm package (pure-JS implementation of the [age](https://age-encryption.org) format). Rationale: (a) the file format is documented and audited, so we do not own the cryptographic envelope; (b) developers can recover their secrets out-of-band with the standard `age` CLI (`age -d -i <config-root>/secrets.key secrets.d/<id>.age`) if the CLI itself is broken or unavailable. Custom XChaCha20-Poly1305 / `@noble/ciphers` constructions are explicitly NOT permitted — the library is fixed at `age-encryption`.

**Per-plugin isolation.** A read of `local.ghcr-token` SHALL touch only `secrets.d/local.age`. Corruption of any single blob SHALL cause `get`, `set`, `delete`, `list`, and `which` to fail with `SecretsBlobCorruptedError` for that plugin only — other plugins' blobs continue to function. The error SHALL surface a remediation hint (delete the blob and re-enter the secrets, or restore from backup).

**Atomic write.** Writes SHALL use temp + rename with `0o600` per [NFR-002](../non-functional/NFR-002-sensitive-file-permissions.md). The blob is read, decrypted, mutated in-memory, re-encrypted, and atomically replaced.

**Identity protection.** `secrets.key` SHALL be created mode `0o600`. If on read the file mode is wider than `0o600`, the service SHALL refuse to load the identity and emit `SecretsIdentityPermissionsError` with remediation. The identity file is never logged, never copied to other paths.

**Memory hygiene.** Decrypted maps SHALL be confined to the smallest scope needed and never assigned to globals. Implementations SHOULD avoid converting decrypted values through unnecessary string copies.

**Probe outcome cached.** Once the file backend is selected (because the keyring probe failed), it remains active for the lifetime of the process; it is not re-checked per call.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-007-AC-1 | With keyring unavailable, `set('local.ghcr-token', v)` creates `<config-root>/secrets.d/local.age` and (if absent) `<config-root>/secrets.key`, both with mode `0o600`. - **FR-007-AC-2a** _(blob does not leak plaintext)_: After `set('local.ghcr-token', v)`, every byte of `<config-root>/secrets.d/local.age` SHALL be inspected. The plaintext value `v` SHALL NOT appear as a contiguous substring of: the raw file bytes, the age-payload base64 body after framing strip, or any per-recipient header. (Round-trip via age decryption with `secrets.key` SHALL recover `v`.) - **FR-007-AC-2b** _(identity file is well-formed)_: `<config-root>/secrets.key` SHALL contain exactly one age X25519 identity in Bech32 form (`AGE-SECRET-KEY-1<...>`), terminated by a single `\n`, with no other content (no comment lines, no trailing recovery copies, no concatenated secrets). Total byte length matches one identity string + one `\n` exactly. | Inspection |
| FR-007-AC-3 | Modifying the last 16 bytes of `secrets.d/local.age` (the age AEAD tag) causes operations on `local.*` to throw `SecretsBlobCorruptedError`; operations on `elements.*` (separate blob) continue to succeed. | Test |
| FR-007-AC-4 | Writing `secrets.d/<id>.age` with `0o644` (simulated tamper) is not produced by the service; all writes observe `0o600` post-rename. | Test |
| FR-007-AC-5 | If `secrets.key` exists with mode wider than `0o600`, the service refuses to use it and throws `SecretsIdentityPermissionsError` naming the path. | Test |
| FR-007-AC-6 | A test scan SHALL find zero plaintext secret values in `secrets.d/*.age` blobs across a full `set/get/delete` lifecycle. | Analysis |

## Dependencies

- **Upstream**: [StR-002](../stakeholder/StR-002-secrets-never-plaintext.md) (implements), [FR-005](./FR-005-secrets-service-api.md) (requires), [NFR-001](../non-functional/NFR-001-no-plaintext-secrets.md) (requires), [NFR-002](../non-functional/NFR-002-sensitive-file-permissions.md) (requires)

