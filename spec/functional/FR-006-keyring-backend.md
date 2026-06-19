---
id: FR-006
title: "OS Keyring Backend (@napi-rs/keyring)"
type: FR
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-002"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-005"
    type: "requires"
    cardinality: "1:1"
---

## Description

The keyring backend SHALL use `@napi-rs/keyring` to bridge to the platform keychain:

| Platform | Backend                                              |
| -------- | ---------------------------------------------------- |
| macOS    | Keychain                                             |
| Linux    | Secret Service (libsecret / gnome-keyring / KWallet) |
| Windows  | Credential Manager                                   |

**Naming.** All entries SHALL use:

- `service = "ix-cli"`
- `account = "<plugin-id>.<secret-name>"`

This namespacing matches `SecretId` ([FR-005](./FR-005-secrets-service-api.md)) so `list()` can enumerate every entry under `service = "ix-cli"` and reconstruct the id.

**Capability probe.** At startup `SecretsService` SHALL run a capability probe consisting of:

1. Resolving the platform binding successfully.
2. Performing a round-trip set/get/delete on a sentinel id `core.__probe__`.

If the probe throws or yields a value mismatch, the keyring backend SHALL be marked unavailable and the service SHALL select the age-file backend ([FR-007](./FR-007-encrypted-file-fallback.md)) instead. The probe runs at most once per process.

**Failure mapping.** Errors from `@napi-rs/keyring` SHALL be wrapped in:

- `KeyringUnavailableError` — when the binding cannot load (e.g. headless WSL without dbus / Secret Service).
- `KeyringAccessError` — when the binding loads but a specific operation fails (e.g. user denied Keychain access).

`KeyringAccessError` SHALL surface a remediation hint (e.g. macOS: "open Keychain Access and grant permission"; Linux: "ensure gnome-keyring or KWallet is unlocked").

**No raw value rendering.** Errors SHALL include the secret id but never the value.

## Acceptance Criteria

| ID          | Criteria                                                                                                                                                                            | Verification |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-006-AC-1 | On macOS, `set('local.ghcr-token', v)` creates a Keychain item with service `ix-cli` and account `local.ghcr-token`; `get(...)` returns the value.                                  | Test         |
| FR-006-AC-2 | On Linux with Secret Service available, the same round-trip succeeds via libsecret.                                                                                                 | Test         |
| FR-006-AC-3 | With Secret Service unavailable (e.g. `DBUS_SESSION_BUS_ADDRESS` unset and no Secret Service daemon running), the capability probe fails and the active backend becomes `age-file`. | Test         |
| FR-006-AC-4 | `list()` enumerates only entries whose service is `ix-cli`; entries written by other applications are ignored.                                                                      | Test         |
| FR-006-AC-5 | A user-denied Keychain prompt produces a `KeyringAccessError` whose message identifies the secret id and includes a platform-appropriate remediation hint.                          | Test         |
| FR-006-AC-6 | The probe runs at most once per process; subsequent secret operations reuse the cached capability result.                                                                           | Test         |

## Dependencies

- **Upstream**: [StR-002](../stakeholder/StR-002-secrets-never-plaintext.md) (implements), [FR-005](./FR-005-secrets-service-api.md) (requires)

## Verification — Platform CI Matrix

The keyring round-trip ACs (FR-006-AC-1 macOS Keychain; FR-006-AC-2 Linux libsecret) require a real platform credential store and SHALL be verified by a GitHub Actions matrix:

| Runner          | Backend                   | Setup                                                                                                                                                                  |
| --------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `macos-latest`  | Keychain                  | Native; no setup required.                                                                                                                                             |
| `ubuntu-latest` | libsecret / gnome-keyring | `sudo apt-get install -y gnome-keyring libsecret-1-0 dbus-x11`; start `gnome-keyring-daemon --components=secrets --start --foreground` in CI shim before the test job. |

The platform matrix runs on every push and PR (security-critical path). Mocked unit tests cover wiring and error mapping in standard CI.
