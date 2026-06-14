---
artifact_type: master-requirements
name: ix-cli-core
org: agent-ix
component_type: node-library
tags:
  - typescript
  - cli-framework
  - oclif
  - config
  - secrets
implementation_language: typescript
depends_on: []
relationships:
  - target: "ix://agent-ix/ix-cli"
    type: "consumed-by"
    cardinality: "1:N"

standards_alignment:
  - iso-iec-ieee-29148
  - ieee-828
---

# Master Requirements Specification

## ix-cli-core — Generic CLI Framework Foundation for Agent IX

---

## 1. Purpose

This document defines the **scope, intent, and governing requirements framework** for `@agent-ix/ix-cli-core`.

It establishes:

- The problem space addressed by the shared CLI framework library
- The boundaries between the generic framework and any specific CLI built on it
- The authoritative structure for requirements, verification, and change control
- The plugin contract enabling typed config/secrets/capability extensions

`@agent-ix/ix-cli-core` is the **generic foundation** every Agent IX CLI imports. It is not a CLI itself. The IX-specific `ix` binary, its `core` plugin schema (auth, telemetry, theme, update-check), and its service plugins are specified in [`ix://agent-ix/ix-cli`](https://github.com/agent-ix/ix-cli) and consume the requirements defined here.

This document is the **top-level requirements artifact** for the repository.

---

## 2. Scope

### 2.1 In Scope

Scope: **Generic framework foundation for building Agent IX CLIs — config service, secrets service, plugin contract, runtime, base command.**

This specification governs:

- **ConfigService** — per-plugin, schema-validated, atomically-written config (`forPlugin`, `get`/`set`/`replace`/`reset`/`filePath`, layered env→file→defaults resolution, per-plugin file isolation, advisory locking, `doctor`).
- **SecretsService** — secret resolution and persistence brokered across pluggable backends (OS keyring via `@napi-rs/keyring`; age-encrypted file fallback; in-memory test backend), never plaintext on disk.
- **Plugin schema contract** — the `ixSchema` named export convention (`id` / `config` / `secrets` / `env`), `registerPluginSchema`, init-failure isolation.
- **Runtime** — `BaseCommand` (with `--config-root` / `--no-project-config` base flags and the capability-resolution `prerun` hook), `CapabilityResolver`, `RuntimeContext`, and oclif-native CLI composition.
- **`config` and `secrets` command runners** — generic, plugin-agnostic command implementations the host binary registers.
- **Atomic-write helper** — the single `0o600` temp+rename writer all governed files go through.

### 2.2 Out of Scope

This specification does not govern:

- Any specific binary, branding, or distribution composition (those live in the consuming CLI repo).
- The IX `core` plugin's concrete `config`/`secrets` schema — including `auth.serviceUrl`, GitHub/IX auth tokens, telemetry, theme, and update-check fields. That declaration is IX-specific and is specified in `ix://agent-ix/ix-cli` (its `FR-020`).
- IX service auth flows (GitHub device flow, IX auth-service token exchange).
- Local cluster, elements, or spec workflow commands.
- Terminal UI component internals (owned by `@agent-ix/ix-ui-cli`).

---

## 3. System Overview

### 3.1 System Description

`@agent-ix/ix-cli-core` is a single publishable TypeScript library (npm package `@agent-ix/ix-cli-core`). It exposes the building blocks below; a consuming CLI is a normal oclif binary that depends on this library, extends `BaseCommand`, lists its plugins in `oclif.plugins`, and registers each plugin's `ixSchema`.

| Module      | Responsibility                                                                 |
| ----------- | ------------------------------------------------------------------------------ |
| `config/`   | `ConfigService`, paths, errors, lock, registry, `doctor`                       |
| `secrets/`  | `SecretsService`, backends (keyring / age-file / memory), registry, defaults   |
| `plugins/`  | `registerPluginSchema` + `IxPluginSchema` contract                             |
| `runtime/`  | `BaseCommand` context, `CapabilityResolver`, capability spec, `RuntimeContext` |
| `commands/` | `config` and `secrets` command runners                                         |
| `atomic/`   | `atomicWrite` — `0o600` temp+rename helper                                     |

### 3.2 Intended Users

- **CLI authors** building an oclif binary on `@agent-ix/ix-cli-core` (including the main `ix` CLI).
- **Plugin authors** publishing oclif plugins that declare config/secrets/env via `ixSchema`.
- **Developers** whose secrets and config the framework manages on their behalf.

---

## 4. Requirements Architecture

Artifacts are organized by class in flat per-class directories:

```
spec/
├── spec.md                     # This document
├── stakeholder/                # StR-XXX  (cross-cutting needs)
├── usecase/                    # US-XXX   (usage scenarios)
├── functional/                 # FR-XXX   (testable behavioral contracts)
├── non-functional/             # NFR-XXX  (quality constraints)
└── tests.md                    # Requirements ↔ tests mapping
```

---

## 5. Requirement Classes

### 5.1 Stakeholder Requirements (`StR-XXX`)

Authoritative needs from CLI authors, plugin authors, and developers.

### 5.2 User Stories (`US-XXX`)

Usage scenarios describing author intent when composing a CLI on the framework.

### 5.3 Functional Requirements (`FR-XXX`)

Testable behavioral contracts for the config service, secrets service, plugin contract, runtime, and command runners.

### 5.4 Non-Functional Requirements (`NFR-XXX`)

Quality constraints: secrets-at-rest, file permissions, error UX, backend pluggability.

---

## 6. Requirement Identification

| Artifact                   | Format      | Example       |
| -------------------------- | ----------- | ------------- |
| Stakeholder Requirement    | `StR-XXX`   | `StR-001`     |
| User Story                 | `US-XXX`    | `US-001`      |
| Functional Requirement     | `FR-XXX`    | `FR-005`      |
| Non-Functional Requirement | `NFR-XXX`   | `NFR-001`     |
| Acceptance Criteria        | `{FR}-AC-N` | `FR-005-AC-1` |
| Test Case                  | `TC-XXX`    | `TC-021`      |

Identifiers are immutable once assigned. IDs in this repo are a flat per-repo sequence (no `core/` classifier).

### 6.1 Requirement Index

| ID      | Title                                                    |
| ------- | -------------------------------------------------------- |
| StR-001 | Pluggable Config Contract with Per-Plugin Isolation      |
| StR-002 | Developer Secrets Never Persisted in Plaintext           |
| StR-003 | Reusable CLI Runtime                                     |
| US-001  | Run Custom CLI Distribution                              |
| FR-001  | ConfigService API                                        |
| FR-002  | Per-Plugin File Isolation and Scoped Failure             |
| FR-003  | Layered Config Resolution: Env → Plugin File → Defaults  |
| FR-004  | Plugin Schema Registration                               |
| FR-005  | SecretsService API                                       |
| FR-006  | OS Keyring Backend (@napi-rs/keyring)                    |
| FR-007  | Encrypted-File Fallback for Headless Environments        |
| FR-008  | `config` Command Group (get, set, edit, doctor)          |
| FR-009  | `secrets` Command Group (list, set, rm, which)           |
| FR-010  | CLI Binary Composition                                   |
| FR-011  | Runtime Config Root Override                             |
| FR-012  | Plugin Discovery (oclif-native)                          |
| FR-013  | Per-Command Capability Binding                           |
| FR-014  | ixSchema Plugin Convention                               |
| NFR-001 | No Plaintext Secret Values Persisted on Disk             |
| NFR-002 | Sensitive Files Created Mode 0600 via Atomic Temp+Rename |
| NFR-003 | Schema Validation Errors Are Actionable                  |
| NFR-004 | Secrets Backend Adapter Pluggability                     |

---

## 7. Requirement Quality Policy

All functional requirements SHALL:

- Define observable behavior
- Be unambiguous and atomic
- Be testable through explicit criteria
- Be free of references to any specific consuming binary (those concerns belong in the consuming CLI's spec)

---

## 8. Config and Secrets Model

### 8.1 Storage Layout (XDG-compliant)

A consuming CLI resolves a **config root** (default `~/.config/<bin>`, overridable via `--config-root` / `IX_CONFIG_ROOT` per FR-011). Within that root:

```
<config-root>/
├── config.yaml              # core-only CLI settings (reserved id "core")
├── secrets.key              # X25519 age identity (mode 0600; only when keyring unavailable)
├── config.d/
│   ├── <plugin-id>.yaml     # per-plugin config
│   └── <plugin-id>.yaml.lock
└── secrets.d/
    └── <plugin-id>.age      # per-plugin age-encrypted blob (mode 0600)
```

Each persisted file owned by the framework is mode `0o600`, written atomically (temp + rename), and refused on read if its mode is wider. Per-plugin file isolation guarantees that a malformed or buggy plugin's config cannot corrupt unrelated plugins (FR-002).

The concrete contents of the `core` plugin's config and secrets schema are **defined by the consuming CLI**, not by this library. The framework reserves the id `core` and routes it to `config.yaml`; what keys live there is the host binary's decision (for the `ix` CLI, see `ix://agent-ix/ix-cli` FR-020).

### 8.2 Configuration Service

Configuration is owned by `ConfigService` (FR-001):

- Plugins access only their own file via `ConfigService.forPlugin(id, schema)` — the API does not expose cross-plugin reads.
- Schemas are Zod `.strict()`; unknown keys are rejected at write time (FR-004).
- Layered resolution: env (`IX_*` per plugin's declared bindings) → plugin's `config.d/<id>.yaml` → schema defaults (FR-003).
- The reserved id `core` is the only plugin allowed to read or write `<config-root>/config.yaml`.
- A parse or validation error on one plugin's file SHALL NOT block other plugins; the offending plugin falls back to schema defaults and the error is surfaced via `config doctor` (FR-002, FR-008).

### 8.3 Secrets Service

Secrets are owned by `SecretsService` (FR-005):

- **Default backend: OS keyring** via `@napi-rs/keyring` — `service = "ix-cli"`, `account = "<plugin-id>.<secret-name>"` (FR-006).
- **Fallback backend: per-plugin age-encrypted blobs** at `secrets.d/<plugin-id>.age` with X25519 identity at `secrets.key` (FR-007). Used only when the keyring capability probe fails.
- Resolution order for `get()`: env (`IX_*` per plugin's declared `envVar`) → active backend → optional masked TTY prompt (FR-005).
- **No secret value is ever persisted in plaintext on disk** (NFR-001).
- Backend pluggability: future Vault / 1Password / Bitwarden adapters register via a typed `SecretsBackend` interface without changes to consumers (NFR-004).

### 8.4 Runtime Config Root Override

`--config-root` is a base flag on `BaseCommand`; oclif parses it normally through the standard flag system. `IX_CONFIG_ROOT` is its environment-variable alias (FR-011). The selected root applies to per-plugin config reads and file-backed secrets when a command runs.

Effective precedence:

```text
flags > env > project config (./.ix) > selected user config root > schema defaults
```

There is no argv preprocessing in any bin script; the root-position form `<bin> --config-root /tmp/ix-ci ...` is intentionally unsupported.

---

## 9. Command Runners

The framework ships generic, plugin-agnostic runners that a host binary registers as command classes:

```
config get [<plugin>] <key>
config set [<plugin>] <key> <value>
config edit [<plugin>]
config doctor

secrets list
secrets set <id>
secrets rm <id>
secrets which <id>
```

All output flows through the host CLI's UI primitives (e.g. `@agent-ix/ix-ui-cli`); the runners never call `console.log` / `process.stdout.write` directly, and `secrets` never echoes a value (FR-008, FR-009).

---

## 10. Plugin Contract

IX CLI plugins are **normal oclif plugins** — npm packages discovered by oclif via the binary's `oclif.plugins` config (or installed at runtime through `@oclif/plugin-plugins`). The IX-specific layering is two small conventions on top of oclif:

1. **`ixSchema` named export** (FR-014). Plugins that need namespaced config, secrets, or env-var bindings export an `ixSchema` object from their package main. The host's `init` hook walks `Config.plugins`, reads each plugin's `ixSchema` if present, and registers schemas with `ConfigService` / `SecretsService` via `registerPluginSchema` (FR-004).

2. **`static capabilities` on command classes** (FR-013). Commands that depend on a capability declare their requirements on the command class; `BaseCommand.prerun` resolves them.

```ts
// @agent-ix/ix-cli-core
export interface IxPluginSchema {
  id?: string; // optional config/secrets namespace
  config?: ZodObject<ZodRawShape>; // MUST be .strict() — see FR-004
  secrets?: SecretDeclaration[];
  env?: Record<string, string>;
}

export interface SecretDeclaration {
  name: string; // full id is "<plugin-id>.<name>"
  description: string;
  required?: boolean;
  envVar?: string; // optional env binding
}

export interface CommandCapabilities {
  required?: ("github" | "ix-api" | "review-service")[];
  optional?: ("github" | "ix-api" | "review-service")[];
}
```

- Plugin install/load identity is the **npm package name**, not a custom registry tag.
- Config and secret namespacing uses `ixSchema.id` when provided, otherwise a safe id derived from the package name.
- The package name `@agent-ix/ix-cli-core` is reserved for the shared library itself; the host binary may use a `core` namespace for its own config without conflict because no plugin can claim that name.

### 10.1 Trust Model

IX CLI plugins run **in-process** with full Node.js privileges. The plugin contract MUST NOT be read as adversarial isolation:

- Per-plugin file isolation in `config.d/` and `secrets.d/` defends against **accidental corruption** from buggy plugins, not against deliberate exfiltration. A malicious plugin can read another plugin's config file directly via `node:fs`; nothing in this spec prevents that.
- The `ConfigService.forPlugin(id, schema)` API takes `id` as a string. Cross-plugin reads are not API-blocked at runtime; the contract that "each plugin reads its own id" is enforced by **static-check lint only** (FR-003-AC-5).
- This posture matches every other in-process plugin CLI (gh, kubectl, aws-cli, oclif, helm, VS Code extensions).

**Operator guidance.** Install only plugins you trust.

### 10.2 CLI Binary Composition

A CLI binary is a normal oclif application that depends on `@agent-ix/ix-cli-core` (for `BaseCommand`, `ConfigService`, `SecretsService`, `CapabilityResolver`, `IxPluginSchema`) and lists its plugin packages in `oclif.plugins`. There is no `Distribution` runtime object — the binary itself is the distribution (FR-010). Per-command capability requirements (FR-013) are declared as `static capabilities` and enforced by `BaseCommand.prerun`. There is no on-disk plugin manifest (FR-012).

---

## 11. Error and Failure Model

- Config validation errors carry the four-tuple `(pluginId, keyPath, expectedType, filePath)` and never expose raw Zod traces (NFR-003).
- Secret errors include the secret id but never the value (FR-005, FR-009).
- All errors are rendered via the host CLI's UI error primitives — no raw `console.error`.
- Registration failures are logged and skipped, never thrown to the process boundary (FR-004).

---

## 12. Traceability

Bidirectional traceability SHALL be maintained between:

- Stakeholder Requirements → Functional Requirements
- Functional Requirements → Acceptance Criteria → Test Cases (see `tests.md`)

---

## 13. Verification Strategy

- Unit tests (vitest) for config resolution, atomic writes, locking, secrets resolution, backend selection, plugin-schema registration, capability resolution, and command runners.
- Static-check tests for the soft-isolation and no-plaintext-secret invariants.
- A platform CI matrix (macOS Keychain, Linux libsecret) for the keyring round-trip ACs (FR-006).

---

## 14. References

- ISO/IEC/IEEE 29148 — Requirements Engineering
- IEEE 828 — Configuration Management
- oclif — plugin framework
- age-encryption — file fallback envelope
- `@napi-rs/keyring` — OS keyring binding
- `ix://agent-ix/ix-cli` — the IX-specific CLI that consumes this framework
