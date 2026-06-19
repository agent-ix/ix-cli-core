# @agent-ix/ix-cli-core

> Generic framework foundation for building Agent IX CLIs — config service, secrets service, plugin contract, runtime.

`ix-cli-core` is the shared substrate every Agent IX command-line tool is built on. It takes the parts of a CLI that are tedious and easy to get wrong — typed configuration, secret storage, login, plugin loading, command wiring — and provides them as a single, batteries-included library on top of [oclif](https://oclif.io/). Your CLI declares _what_ it needs; the framework handles _how_ it is stored, validated, resolved, and secured.

```bash
pnpm add @agent-ix/ix-cli-core
```

> Requires `@oclif/core` (peer dependency) `>= 4.11.4`.

---

## Features

### 🗂 Typed configuration

Plugin-scoped configuration files backed by [Zod](https://zod.dev/) schemas. Each plugin owns its own YAML file under the user's config directory, and every read is validated and type-safe.

- **Schema-validated** — values are parsed against a strict Zod schema; unknown keys are rejected.
- **Layered resolution** — environment variables override file values, which override schema defaults.
- **Project-local overrides** — an in-repo `.ix/` directory can layer per-project settings over the user config.
- **Crash-proof reads** — a corrupt or invalid file never throws into your command; defaults are returned and the problem is recorded for diagnostics.
- **Safe writes** — every write is atomic, permission-locked (`0o600`), and serialized against concurrent writers.
- **Built-in diagnostics** — a `doctor` report surfaces parse, schema, and I/O incidents across all plugins.

### 🔐 Multi-backend secrets

Secret storage that does the right thing on every platform without the caller caring where bytes actually live.

- **OS-native keyring first** — uses the macOS Keychain, Windows Credential Manager, or Linux Secret Service when available.
- **Encrypted file fallback** — transparently falls back to an [age](https://age-encryption.org/)-encrypted on-disk store when no keyring is present.
- **Environment overrides** — a declared env var always wins, so CI and containers can inject secrets without touching disk.
- **Leak-resistant** — secret values are kept out of logs and error messages; only ids and descriptions are ever rendered.

### 🔑 Auth engine (device flow)

A drop-in OAuth 2.0 Device Authorization Grant ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)) login, fully service-agnostic.

- **Service discovery** — reads a `/.well-known/agentix-service.json` document so endpoints, audience, and scopes are never hard-coded.
- **Browser-based approval** — walks the user through verification with a best-effort, non-fatal browser open.
- **Host-isolated tokens** — tokens are keyed per host and stored through the secrets backend; logging into one service never disturbs another.
- **Automatic refresh** — access tokens are refreshed before expiry and rotated transparently.

### 🧩 Plugin contract

A lightweight convention that lets a plugin declare everything the framework needs in one object.

- A plugin exports an `ixSchema` describing its **config schema**, **secrets**, and **env bindings**.
- The host registers it once at startup, and the plugin's config and secrets immediately become visible to `ix config` and `ix secrets`.
- Plugin namespaces are derived safely from the npm package name when not given explicitly.

### ⚙️ Base command + capabilities

An oclif base command that every command in your CLI extends to inherit framework wiring for free.

- **Standard flags** — `--config-root` and `--no-project-config` are parsed natively, no argv hacks.
- **Ready-to-use services** — config and secrets are available without per-command boilerplate.
- **Declarative capability checks** — a command states the capabilities it requires (e.g. "needs auth"), and the framework short-circuits with a structured, user-friendly error when they are unavailable.

### 📦 Plugin marketplace

A thin adapter over [`@agent-ix/ts-plugin-kit`](https://github.com/agent-ix/ts-plugin-kit) for installing and reconciling plugins from typed git sources, with a cache layout under the standard cache directory.

### 🛡 Safe filesystem & XDG paths

The primitives the rest of the framework is built on: XDG-compliant config and cache locations, and atomic writes that enforce `0o600` permissions and refuse to follow symlinks.

---

## Usage Guide

This walkthrough builds up a CLI on the framework, one subsystem at a time. Everything is imported from the package root:

```ts
import {
  ConfigService,
  registerPluginSchema,
  registerSecret,
  SecretsService,
  defaultSecretsService,
  fetchServiceDiscovery,
  runDeviceFlow,
  TokenStore,
  BaseCommand,
} from "@agent-ix/ix-cli-core";
import { z } from "zod";
```

### 1. Declare your plugin schema

A plugin describes its config, secrets, and env bindings in a single `ixSchema` object and registers it at startup. Config schemas must be **strict** Zod objects.

```ts
const ixSchema = {
  id: "deploy", // config/secrets namespace; derived from the package name if omitted
  config: z
    .object({
      region: z.string().default("us-east-1"),
      replicas: z.coerce.number().default(1),
    })
    .strict(),
  secrets: [
    {
      name: "api-token",
      description: "Deploy API token",
      envVar: "DEPLOY_API_TOKEN",
    },
  ],
  env: { region: "DEPLOY_REGION" }, // config key → env var
};

const result = registerPluginSchema("@acme/ix-cli-deploy", ixSchema);
if (!result.ok) {
  // first-wins, non-throwing: inspect result.kind / result.detail
  console.warn(`plugin schema not registered: ${result.detail}`);
}
```

Registering the schema also wires its config and secrets into the global registries, so `ix config` and `ix secrets` see the plugin immediately.

### 2. Read and write typed config

Get a typed accessor scoped to one plugin id. `get()` resolves env → file → defaults; `set()` deep-merges and atomically rewrites.

```ts
const config = ConfigService.forPlugin("deploy", ixSchema.config, {
  envBindings: { region: "DEPLOY_REGION" },
});

const current = config.get(); // { region: string; replicas: number } — fully typed
config.set({ replicas: 3 }); // validated, atomic, lock-serialized write
config.replace({ region: "eu-west-1", replicas: 2 }); // overwrite (can remove keys)
config.reset(); // delete the file; get() then returns defaults
```

Diagnose problems across all registered plugins:

```ts
import { doctor } from "@agent-ix/ix-cli-core";

const report = doctor(); // parse / schema / io incidents, per plugin
```

### 3. Store and read secrets

Secrets are declared (so they appear in `ix secrets list`) and then read or written through a `SecretsService`. The framework picks the backend; in most commands you use the process-global default.

```ts
registerSecret("deploy", {
  name: "api-token",
  description: "Deploy API token",
  envVar: "DEPLOY_API_TOKEN",
});

const secrets = defaultSecretsService();

await secrets.set("deploy.api-token", "s3cr3t"); // refuses if env var is shadowing
const token = await secrets.get("deploy.api-token"); // env var > backend > null
const source = await secrets.which("deploy.api-token"); // "env" | "keyring" | "age-file" | "unset"
```

`get()` returns the env-var value first when the secret's `envVar` is set, then falls back to the active backend, then `null`.

### 4. Wire up login

Discover the service, run the device flow, and persist the resulting tokens in a host-keyed `TokenStore` (backed by the secrets service).

```ts
const discovery = await fetchServiceDiscovery("https://api.example.com");

const bundle = await runDeviceFlow(discovery, {
  clientId: "my-cli",
  prompter: {
    showVerification({ approvalUri, userCode }) {
      console.log(`Visit ${approvalUri} and enter code ${userCode}`);
    },
  },
});

const tokens = new TokenStore({ secrets: defaultSecretsService() });
await tokens.save("https://api.example.com", bundle);

// Later, in any command — refreshed automatically when near expiry:
const accessToken = await tokens.getAccessToken("https://api.example.com");
```

By default `runDeviceFlow` opens the verification URI in a browser (non-fatal) and presents the prompt through the `prompter` you supply, so your CLI owns all rendering.

### 5. Author a command

Extend `BaseCommand` to inherit the global flags and runtime context, and declare any capabilities the command requires. A missing required capability short-circuits the command with a structured error before `run()` executes.

```ts
export default class Deploy extends BaseCommand {
  static override description = "Deploy the current project";

  static override capabilities = {
    required: ["ix-api"], // resolved in prerun(); fails fast if unavailable
    optional: ["github"],
  } as const;

  async run(): Promise<void> {
    const config = ConfigService.forPlugin("deploy", ixSchema.config);
    const { region, replicas } = config.get();
    this.log(`Deploying ${replicas} replica(s) to ${region}…`);

    if (this.hasCapability("github")) {
      // optional capability is available — do the extra thing
    }
  }
}
```

### 6. Install marketplace plugins (optional)

For CLIs that load plugins from typed git sources, the marketplace adapter provides install options and a reconcile pass over a default set:

```ts
import {
  marketplaceInstallOptions,
  reconcileDefaultSet,
} from "@agent-ix/ix-cli-core";

const opts = marketplaceInstallOptions();
await reconcileDefaultSet(/* targets */);
```

---

## Related projects

- **[ix-cli](https://github.com/agent-ix/ix-cli)** — the canonical Agent IX CLI (`ix`), built on this framework. _(Currently private; will be made public soon.)_
- **[quoin](https://github.com/agent-ix/quoin)** — the spec authoring and validation toolchain for the Agent IX ecosystem.
- **[ix-flow](https://github.com/agent-ix/ix-flow)** — the agent-driven workflow lifecycle runner.

---

## Development

This project uses **pnpm** with **Corepack**.

### Prerequisites

- Node.js 20+
- Corepack enabled (`corepack enable`)

### Setup

```bash
pnpm install      # install dependencies
pnpm run build    # build the library (vite)
pnpm run test     # run the test suite (vitest)
```

### Scripts

| Command           | Description                             |
| ----------------- | --------------------------------------- |
| `pnpm run build`  | Compile the library                     |
| `pnpm test`       | Run tests                               |
| `pnpm run lint`   | Run ESLint + Prettier check             |
| `pnpm run format` | Run Prettier                            |
| `pnpm run clean`  | Remove build artifacts and node_modules |

A `Makefile` is provided for convenience and delegates to the equivalent `pnpm run` scripts (`make build`, `make test`, `make lint`, …).

---

## License

[MIT](./LICENSE) © Agent IX
