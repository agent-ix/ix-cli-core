import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  configureRuntimeContext,
  marketplaceInstallOptions,
  reconcileDefaultSet,
  resetRuntimeContext,
  resolveOclifPluginInstall,
} from "../src";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `ixcc-${prefix}-`));
}

function fixtureModule(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.yaml"), `name: ${name}\nversion: 0.1.0\n`);
  return dir;
}

function readName(dir: string): string {
  const text = readFileSync(join(dir, "manifest.yaml"), "utf8");
  return /name:\s*(.+)/.exec(text)![1].trim();
}

afterEach(() => resetRuntimeContext());

test("marketplaceInstallOptions derives cache under cacheRoot (FR-019-AC-1)", () => {
  const configRoot = tmp("cfg");
  configureRuntimeContext({ configRoot });
  const opts = marketplaceInstallOptions({
    targetRoot: "/t",
    registryPath: "/r.json",
    readName,
    materialize: "copy",
  });
  expect(opts.cacheRoot).toBe(join(configRoot, "cache", "ts-plugin-kit"));
  expect(opts.targetRoot).toBe("/t");
  expect(opts.registryPath).toBe("/r.json");
  expect(opts.materialize).toBe("copy");
});

test("reconcileDefaultSet installs the enabled set (FR-019-AC-2)", () => {
  configureRuntimeContext({ configRoot: tmp("cfg2") });
  const mod = fixtureModule(tmp("src"), "demo-module");
  const home = tmp("home");
  const result = reconcileDefaultSet(
    {
      schemaVersion: 1,
      entries: [{ name: "demo-module", source: { type: "path", path: mod } }],
    },
    {
      targetRoot: join(home, "modules"),
      registryPath: join(home, "registry.json"),
      readName,
    },
  );
  expect(result.installed).toHaveLength(1);
  expect(
    existsSync(join(home, "modules", "demo-module", "manifest.yaml")),
  ).toBe(true);
});

test("resolveOclifPluginInstall maps npm→install and git/path→link (FR-019-AC-3)", () => {
  const cacheRoot = tmp("cache");
  expect(
    resolveOclifPluginInstall(
      { type: "npm", package: "@x/y", version: "1.0.0" },
      { cacheRoot },
    ),
  ).toEqual({ kind: "install", spec: "@x/y@1.0.0" });
  expect(
    resolveOclifPluginInstall({ type: "npm", package: "@x/y" }, { cacheRoot }),
  ).toEqual({
    kind: "install",
    spec: "@x/y",
  });

  const mod = fixtureModule(tmp("link-src"), "linkme");
  const linked = resolveOclifPluginInstall(
    { type: "path", path: mod },
    { cacheRoot },
  );
  expect(linked.kind).toBe("link");
  expect(linked).toEqual({ kind: "link", localPath: mod });
});
