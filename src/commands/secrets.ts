import { password } from "@clack/prompts";
import { startListing } from "@agent-ix/ix-ui-cli";

import { defaultSecretsService } from "../secrets/default.js";
import {
  SecretsService,
  type SecretsServiceOptions,
} from "../secrets/service.js";
import {
  assertValidSecretId,
  EmptySecretValueError,
} from "../secrets/types.js";

export interface SecretsCommandDeps {
  /** Inject a SecretsService (for tests / non-default backends). */
  service?: SecretsService;
  /** Inject a value supplier (for tests / non-TTY scripts). */
  promptForValue?: (id: string) => Promise<string>;
}

function pickService(deps: SecretsCommandDeps): SecretsService {
  return deps.service ?? defaultSecretsService();
}

function ensureRegistered(id: string): void {
  assertValidSecretId(id); // throws InvalidSecretIdError on malformed id
  SecretsService.assertRegistered(id); // throws UnknownSecretError if not in registry
}

/* ── runSecretsList ──────────────────────────────────────────────────── */

export async function runSecretsList(
  deps: SecretsCommandDeps = {},
): Promise<void> {
  const svc = pickService(deps);
  const rows = await svc.list();

  const list = startListing("ix secrets list");
  if (rows.length === 0) {
    list.note("(no secrets declared by any plugin)");
    list.success("done");
    return;
  }
  for (const row of rows) {
    list.item(
      row.id,
      `${row.source} (backend=${row.backend}) — ${row.description}`,
    );
  }
  list.success(`${rows.length} secret(s)`);
}

/* ── runSecretsSet ───────────────────────────────────────────────────── */

export async function runSecretsSet(
  id: string,
  deps: SecretsCommandDeps = {},
): Promise<void> {
  ensureRegistered(id);
  const svc = pickService(deps);

  const list = startListing("ix secrets set");
  const promptFn =
    deps.promptForValue ??
    (async (sid: string) => {
      const r = await list.pause(() =>
        password({
          message: `Enter value for ${sid}`,
          mask: "*",
        }),
      );
      if (typeof r !== "string") {
        // User cancelled (Esc / Ctrl+C).
        throw new Error("aborted by user");
      }
      return r;
    });

  const value = await promptFn(id);
  if (value.length === 0) {
    list.error("empty value rejected");
    throw new EmptySecretValueError(id);
  }
  await svc.set(id, value);
  const backend = await svc.activeBackendId();
  list.success(`stored ${id} in ${backend}`);
}

/* ── runSecretsRm ────────────────────────────────────────────────────── */

export async function runSecretsRm(
  id: string,
  opts: { strict?: boolean } = {},
  deps: SecretsCommandDeps = {},
): Promise<{ exitCode: number }> {
  ensureRegistered(id);
  const svc = pickService(deps);

  const list = startListing("ix secrets rm");
  await svc.delete(id);

  const which = await svc.which(id);
  if (which === "env") {
    const msg = `${id} cleared from backend, but env var still satisfies get() (which=env)`;
    if (opts.strict) {
      list.error(msg);
      return { exitCode: 1 };
    }
    list.warn(msg);
    return { exitCode: 0 };
  }
  list.success(`${id} cleared`);
  return { exitCode: 0 };
}

/* ── runSecretsWhich ─────────────────────────────────────────────────── */

export async function runSecretsWhich(
  id: string,
  deps: SecretsCommandDeps = {},
): Promise<void> {
  ensureRegistered(id);
  const svc = pickService(deps);
  const which = await svc.which(id);

  const list = startListing("ix secrets which");
  list.item(id, which);
  list.success("done");
}

/** Re-export for the apps/ix wrappers + tests. */
export { UnknownSecretError } from "../secrets/types.js";

/** Test-friendly factory: build a service with the same shape the runners
 * normally see. */
export function newSecretsServiceForTesting(
  opts: SecretsServiceOptions,
): SecretsService {
  return new SecretsService(opts);
}
