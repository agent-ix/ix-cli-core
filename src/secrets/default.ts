import { AgeFileBackend } from "./backends/age-file.js";
import { KeyringBackend } from "./backends/keyring.js";
import { SecretsService, type SecretsBackendMode } from "./service.js";

let cached: SecretsService | undefined;

/**
 * Process-global SecretsService used by `ix config` / `ix secrets` commands
 * and by package consumers that haven't received an explicit instance.
 *
 * On first access:
 * - Constructs a SecretsService with `mode: "auto"` and registers the v1
 *   `keyring` and `age-file` backends.
 * - Subsequent calls return the same instance.
 *
 * Slice-10 work (`apps/ix/src/hooks/init.ts`) overrides the cached instance
 * with one whose `mode` reflects `core.secretsBackend`. Tests do the same
 * via `setDefaultSecretsService(stub)`.
 */
export function defaultSecretsService(
  mode: SecretsBackendMode = "auto",
): SecretsService {
  if (cached) return cached;
  cached = new SecretsService({
    mode,
    backends: new Map([
      ["keyring", new KeyringBackend()],
      ["age-file", new AgeFileBackend()],
    ]),
  });
  return cached;
}

/** Replace the cached service. Used by the apps/ix init hook + tests. */
export function setDefaultSecretsService(svc: SecretsService): void {
  cached = svc;
}

/** Drop the cached service so the next `defaultSecretsService()` reconstructs. */
export function resetDefaultSecretsService(): void {
  cached = undefined;
}
