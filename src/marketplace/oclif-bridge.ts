import { join } from "node:path";

import {
  resolveSource,
  type ResolveOptions,
  type Source,
} from "@agent-ix/ts-plugin-kit";

import { cacheRoot } from "../config/paths.js";

/**
 * An oclif-installable instruction derived from a marketplace source. The host
 * (`apps/ix`) dispatches these to `@oclif/plugin-plugins` — `plugins:link` for a
 * resolved local dir, `plugins:install` for an npm spec. ix-cli-core never
 * imports `@oclif/plugin-plugins`; it only computes the instruction.
 */
export type OclifPluginInstall =
  | { kind: "link"; localPath: string }
  | { kind: "install"; spec: string };

/**
 * Map a {@link Source} to an oclif command-plugin install instruction. `npm`
 * sources become an `install` spec (no fetch needed); every other source is
 * fetched + pinned by the leaf library and becomes a `link` to the resolved dir.
 */
export function resolveOclifPluginInstall(
  source: Source,
  opts: ResolveOptions = { cacheRoot: join(cacheRoot(), "ts-plugin-kit") },
): OclifPluginInstall {
  if (source.type === "npm") {
    const spec = source.version
      ? `${source.package}@${source.version}`
      : source.package;
    return { kind: "install", spec };
  }
  return { kind: "link", localPath: resolveSource(source, opts).dir };
}
