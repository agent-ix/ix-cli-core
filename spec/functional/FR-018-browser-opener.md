---
id: FR-018
title: "Non-Fatal Browser Opener"
type: FR
object: api_endpoint
relationships:
  - target: "ix://agent-ix/ix-cli-core/spec/stakeholder/StR-003"
    type: "implements"
    cardinality: "1:1"
  - target: "ix://agent-ix/ix-cli-core/spec/functional/FR-016"
    type: "required-by"
    cardinality: "1:1"
---

## Description

`@agent-ix/ix-cli-core` SHALL export a best-effort, non-fatal browser opener
used by the device-flow runner ([FR-016](./FR-016-device-flow-runner.md)) to surface the verification URI:

```typescript
function openBrowser(
  url: string,
  opts?: { env?: NodeJS.ProcessEnv },
): Promise<boolean>;
```

**Non-fatal.** The opener MUST NOT throw on failure and MUST NOT block the
login flow. Login proceeds whether or not a browser actually opens; the
verification URI is always printed by the runner regardless.

**Environment-aware launcher selection.** The opener SHALL pick a platform
launcher: `open` on macOS, `cmd /c start` on Windows, and the standard Linux
openers (`xdg-open`, `gio open`). Under WSL (detected via `WSL_DISTRO_NAME` /
`WSL_INTEROP`), it SHALL prefer `wslview` and `cmd.exe /c start` before the
Linux openers, since `xdg-open` is commonly absent or broken there.

**Opt-out.** When `IX_NO_BROWSER` or `NO_BROWSER` is set to a truthy value, the
opener SHALL return `false` without spawning anything (headless / CI / scripted
runs).

**Return value.** Resolves `true` when a launcher process started without an
immediate error, `false` otherwise. A `true` result does not guarantee a window
appeared — only that the launch did not synchronously fail.

## Acceptance Criteria

| ID | Criteria | Verification |
|----|----------|--------------|
| FR-018-AC-1 | `openBrowser` never rejects; a launcher that cannot be spawned resolves `false`. | Test |
| FR-018-AC-2 | With `IX_NO_BROWSER=1` (or `NO_BROWSER=1`) in the supplied env, the opener returns `false` and spawns no process. | Test |
| FR-018-AC-3 | When the device-flow runner's injected opener throws, the flow still completes (cross-checked by [FR-016-AC-7](./FR-016-device-flow-runner.md)). | Test |

## Dependencies

- **Upstream**: [StR-003](../stakeholder/StR-003-reusable-cli-runtime.md) (implements)
- **Downstream**: [FR-016](./FR-016-device-flow-runner.md) (required-by)

## Endpoint

In-process TypeScript API exposed by `@agent-ix/ix-cli-core` (`src/auth/`).
Spawns a detached, `stdio: "ignore"` child process; never reads its output.

| Symbol        | Signature                                                               | Returns               | Description                                                |
| ------------- | ----------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| `openBrowser` | `(url: string, opts?: { env?: NodeJS.ProcessEnv }) => Promise<boolean>` | spawned-without-error | Best-effort, non-fatal, WSL/headless-aware browser opener. |
