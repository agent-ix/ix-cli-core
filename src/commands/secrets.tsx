import type React from "react";
import {
  Listing,
  Item,
  Note,
  PasswordPrompt,
  render,
  renderStatic,
  useEffect,
  useRenderResult,
  useState,
} from "@agent-ix/ix-ui-cli";

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
  service?: SecretsService;
  promptForValue?: (id: string) => Promise<string>;
}

function pickService(deps: SecretsCommandDeps): SecretsService {
  return deps.service ?? defaultSecretsService();
}

function ensureRegistered(id: string): void {
  assertValidSecretId(id);
  SecretsService.assertRegistered(id);
}

/** Render a PasswordPrompt and resolve with the entered value, or null if
 *  the user cancelled. */
async function promptForPassword(message: string): Promise<string | null> {
  let captured: string | null = null;
  let cancelled = false;
  const Capture: React.FC = () => {
    const { exit } = useRenderResult();
    const [done, setDone] = useState(false);
    useEffect(() => {
      if (done) {
        const t = setTimeout(exit, 0);
        return () => clearTimeout(t);
      }
    }, [done, exit]);
    return (
      <PasswordPrompt
        message={message}
        onSubmit={(r) => {
          if (r.ok) captured = r.value;
          else cancelled = true;
          setDone(true);
        }}
      />
    );
  };
  await render(<Capture />);
  return cancelled ? null : captured;
}

/* ── runSecretsList ──────────────────────────────────────────────────── */

export async function runSecretsList(
  deps: SecretsCommandDeps = {},
): Promise<void> {
  const svc = pickService(deps);
  const rows = await svc.list();

  if (rows.length === 0) {
    await renderStatic(
      <Listing header="ix secrets list" status="passed" tail="done">
        <Note>(no secrets declared by any plugin)</Note>
      </Listing>,
    );
    return;
  }
  await renderStatic(
    <Listing
      header="ix secrets list"
      status="passed"
      tail={`${rows.length} secret(s)`}
    >
      {rows.map((row) => (
        <Item
          key={row.id}
          name={row.id}
          description={`${row.source} (backend=${row.backend}) — ${row.description}`}
        />
      ))}
    </Listing>,
  );
}

/* ── runSecretsSet ───────────────────────────────────────────────────── */

export async function runSecretsSet(
  id: string,
  deps: SecretsCommandDeps = {},
): Promise<void> {
  ensureRegistered(id);
  const svc = pickService(deps);

  const promptFn =
    deps.promptForValue ??
    (async (sid: string): Promise<string> => {
      const r = await promptForPassword(`Enter value for ${sid}`);
      if (r == null) throw new Error("aborted by user");
      return r;
    });

  const value = await promptFn(id);
  if (value.length === 0) {
    await renderStatic(
      <Listing
        header="ix secrets set"
        status="failed"
        tail="empty value rejected"
        tailVariant="error"
      />,
    );
    throw new EmptySecretValueError(id);
  }
  await svc.set(id, value);
  const backend = await svc.activeBackendId();
  await renderStatic(
    <Listing
      header="ix secrets set"
      status="passed"
      tail={`stored ${id} in ${backend}`}
    />,
  );
}

/* ── runSecretsRm ────────────────────────────────────────────────────── */

export async function runSecretsRm(
  id: string,
  opts: { strict?: boolean } = {},
  deps: SecretsCommandDeps = {},
): Promise<{ exitCode: number }> {
  ensureRegistered(id);
  const svc = pickService(deps);

  await svc.delete(id);

  const which = await svc.which(id);
  if (which === "env") {
    const msg = `${id} cleared from backend, but env var still satisfies get() (which=env)`;
    if (opts.strict) {
      await renderStatic(
        <Listing
          header="ix secrets rm"
          status="failed"
          tail={msg}
          tailVariant="error"
        />,
      );
      return { exitCode: 1 };
    }
    await renderStatic(
      <Listing
        header="ix secrets rm"
        status="passed"
        tail={msg}
        tailVariant="warn"
      />,
    );
    return { exitCode: 0 };
  }
  await renderStatic(
    <Listing header="ix secrets rm" status="passed" tail={`${id} cleared`} />,
  );
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

  await renderStatic(
    <Listing header="ix secrets which" status="passed" tail="done">
      <Item name={id} description={which} />
    </Listing>,
  );
}

export { UnknownSecretError } from "../secrets/types.js";

export function newSecretsServiceForTesting(
  opts: SecretsServiceOptions,
): SecretsService {
  return new SecretsService(opts);
}
