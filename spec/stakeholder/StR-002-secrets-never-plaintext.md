---
id: StR-002
title: "Developer Secrets Never Persisted in Plaintext"
type: StR
relationships: []
---

## Stakeholder Need

A CLI that persists developer credentials (registry tokens, service auth tokens, plugin secrets) in plaintext on disk — even at mode `0o600` — is inadequately defended: backups, sync tools, container images, accidental tarballs, and shoulder-surfing all expose the token. Other developer CLIs in the same role — `gh`, `aws`, `gcloud`, Docker Desktop on macOS — store their credentials in the OS keyring (Keychain, libsecret/gnome-keyring, Windows Credential Manager) precisely because plaintext on disk is no longer acceptable practice.

**Stakeholders** — developers using a framework-built CLI on workstations, laptops, and headless WSL/CI-like environments — need:

1. Persisted secrets protected at rest by OS-managed encryption when available.
2. A documented, encrypted fallback when the OS keyring is unavailable (e.g. headless Linux without dbus / Secret Service), so the CLI still works without ever resorting to plaintext on disk.
3. A pluggable backend interface so the secrets layer can later target external systems (HashiCorp Vault, 1Password, Bitwarden) without rewriting consumers.
4. Per-plugin secret namespacing so a buggy plugin cannot accidentally read another plugin's secrets, and so a corrupted fallback blob for one plugin does not destroy secrets for the rest.

## Rationale

Plaintext credentials on disk — even at mode `0o600` — are routinely promoted
into less-protected contexts by backups, sync tools, container images, and
accidental tarballs, and remain exposed to shoulder-surfing. Peer developer CLIs
(`gh`, `aws`, `gcloud`, Docker Desktop) store credentials in the OS keyring for
exactly this reason. A keyring-first secrets layer with an encrypted fallback and
per-plugin namespacing preserves the at-rest guarantee on every supported
environment, including headless hosts without a keyring.

## Priority

Must-Have

## Validation Criteria

- **StR-002-AC-1**: No secret value managed by `SecretsService` is ever persisted to disk in unencrypted form. Keyring entries are protected by the OS; the file fallback is protected by an age-encrypted blob.
- **StR-002-AC-2**: When the OS keyring is available (capability probe succeeds), all secret writes target the keyring; the fallback file is never created.
- **StR-002-AC-3**: When the keyring is unavailable, secrets are stored per-plugin under `<config-root>/secrets.d/<plugin-id>.age`; corruption of one file does not affect secrets stored under a different plugin id.
- **StR-002-AC-4**: Secret ids are namespaced as `<plugin-id>.<secret-name>`; the API does not permit a plugin to read another plugin's secret without explicitly naming it.
- **StR-002-AC-5**: The `SecretsService` accepts additional backend adapters (Vault, 1Password, Bitwarden) via a typed interface without changes to consumer code; v1 ships keyring + age-file only.
