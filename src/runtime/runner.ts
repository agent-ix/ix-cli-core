import {
  Config,
  execute as oclifExecute,
  run as oclifRun,
  type Interfaces,
} from "@oclif/core";

/**
 * oclif runner + core-plugin host for IX CLIs (FR-015).
 *
 * A consuming binary (e.g. quoin) ships a thin `bin` script that simply
 * delegates to this runner:
 *
 * ```js
 * #!/usr/bin/env node
 * import { run } from "@agent-ix/ix-cli-core";
 * await run(undefined, import.meta.url);
 * ```
 *
 * The runner is a wafer-thin wrapper over `@oclif/core`. Command discovery
 * (the consumer's own `oclif.commands` dir) and **core-plugin** discovery
 * (packages listed in the consumer's `package.json` `oclif.plugins` array
 * that are also declared as `dependencies`) are performed by `@oclif/core`'s
 * own `Config` loader. ix-cli-core never imports `@oclif/plugin-plugins`:
 * runtime, user-installed plugins are out of scope — only **bundled** core
 * plugins shipped as dependencies of the host CLI are loaded.
 *
 * `BaseCommand` subclasses contributed by either the host or a core plugin
 * run unchanged: their base flags (`--config-root`, `--no-project-config`)
 * and capability hooks are wired through `init()`/`prerun()` exactly as they
 * are when run directly.
 */

/**
 * Options accepted by {@link run}: a pre-loaded {@link Config}, a directory /
 * file-URL string (e.g. `import.meta.url`), an oclif `Options` object, or
 * `undefined` to fall back to the caller's module location.
 */
export type RunnerLoadOptions = Interfaces.LoadOptions;

/**
 * Run an IX CLI from `argv`.
 *
 * Loads the consuming CLI's oclif {@link Config} from `options` (resolving its
 * `commands` dir and core `plugins`), then dispatches the requested command.
 * Returns the command's result; throws on error (it does **not** call
 * `process.exit`, so it is safe to use in tests). Use {@link execute} for a
 * top-level bin that should handle errors and set the process exit code.
 *
 * @param argv argument vector (defaults to `process.argv.slice(2)`)
 * @param options config source — defaults to oclif's own resolution
 */
export async function run(
  argv?: string[],
  options?: RunnerLoadOptions,
): Promise<unknown> {
  return oclifRun(argv ?? process.argv.slice(2), options);
}

/**
 * Load-and-run entry point for a top-level bin script.
 *
 * Thin pass-through to `@oclif/core`'s `execute`, which loads the config from
 * `dir` (typically `import.meta.url`), runs the command, flushes output, and
 * handles errors / process exit codes. Prefer {@link run} in tests.
 */
export async function execute(options: {
  args?: string[];
  development?: boolean;
  dir?: string;
  loadOptions?: RunnerLoadOptions;
}): Promise<unknown> {
  return oclifExecute(options);
}

/**
 * Load the consuming CLI's oclif {@link Config} without running a command.
 *
 * Exposes the host's resolved plugin/command graph so a CLI (or a test) can
 * introspect what was discovered — including core plugins — before dispatch.
 * The returned config can be passed straight back into {@link run} as
 * `options` to avoid re-resolving.
 */
export async function loadConfig(options?: RunnerLoadOptions): Promise<Config> {
  return Config.load(options);
}

/** A core plugin discovered and loaded by the host. */
export interface CorePluginInfo {
  /** Package name of the plugin. */
  name: string;
  /** Absolute path to the plugin package root. */
  root: string;
  /** oclif plugin type — `core` for bundled host plugins. */
  type: string;
  /** Command ids contributed by this plugin. */
  commandIDs: string[];
}

/**
 * List the **core plugins** loaded into a {@link Config} (excludes the root/host
 * plugin itself). These are the packages from the host's `oclif.plugins` that
 * `@oclif/core` resolved from its dependencies. Useful for `doctor`/diagnostic
 * output and for asserting plugin-host wiring in tests.
 */
export function listCorePlugins(config: Config): CorePluginInfo[] {
  return [...config.plugins.values()]
    .filter((p) => !p.isRoot && p.type === "core")
    .map((p) => ({
      name: p.name,
      root: p.root,
      type: p.type,
      commandIDs: [...p.commandIDs],
    }));
}
