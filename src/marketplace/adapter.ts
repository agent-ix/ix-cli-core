import { join } from "node:path";

import {
  reconcile,
  type InstallOptions,
  type MarketplaceManifest,
  type ReconcileResult,
} from "@agent-ix/ts-plugin-kit";

import { cacheRoot } from "../config/paths.js";

/**
 * Where a host wants a marketplace's modules materialized + tracked. The cache
 * root is supplied by ix-cli-core (under {@link cacheRoot}); the host owns the
 * target dir, registry path, and how a module name is derived.
 */
export interface MarketplaceTarget {
  targetRoot: string;
  registryPath: string;
  readName: (dir: string) => string;
  materialize?: "symlink" | "copy";
}

/** Build `@agent-ix/ts-plugin-kit` install options wired to ix-cli-core's cache root. */
export function marketplaceInstallOptions(
  target: MarketplaceTarget,
): InstallOptions {
  return {
    cacheRoot: join(cacheRoot(), "ts-plugin-kit"),
    targetRoot: target.targetRoot,
    registryPath: target.registryPath,
    readName: target.readName,
    materialize: target.materialize,
  };
}

/**
 * Reconcile a marketplace manifest's default set into the host's target dir,
 * using ix-cli-core's cache layout. Thin adapter over the leaf library — the
 * fetch/pin/registry mechanism lives there, not here.
 */
export function reconcileDefaultSet(
  manifest: MarketplaceManifest,
  target: MarketplaceTarget,
  mode: "lazy" | "sync" = "lazy",
): ReconcileResult {
  return reconcile(manifest, { ...marketplaceInstallOptions(target), mode });
}
