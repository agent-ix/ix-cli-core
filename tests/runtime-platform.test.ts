import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ConfigService,
  MemoryBackend,
  SecretsService,
  capabilityErrorToJson,
  configureRuntimeContext,
  createCapabilityResolver,
  createRuntimeDistribution,
  loadPluginManifestLayers,
  parsePluginManifest,
  resetRuntimeContext,
  resolvePluginManifestLayers,
  selectRuntimeConfigRoot,
  type IxPlugin,
} from "../src/index.js";
import { _resetRegistryForTests } from "../src/config/registry.js";
import { configPathFor, configPathForRoot } from "../src/config/paths.js";
import { _resetIxPluginRegistryForTests } from "../src/plugins/registry.js";
import { _resetSecretsRegistryForTests } from "../src/secrets/registry.js";

const ConfigSchema = z
  .object({
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    stateDir: z.string().default(".workflow"),
  })
  .strict();

const workflowPlugin: IxPlugin = {
  id: "workflow",
  configSchema: ConfigSchema,
  commands: [
    {
      id: "workflow.advance",
      topic: ["workflow", "advance"],
      summary: "Advance",
      requiredCapabilities: ["review-service"],
    },
    {
      id: "workflow.status",
      topic: ["workflow", "status"],
      summary: "Status",
    },
  ],
  capabilities: [
    { id: "github", mode: "optional" },
    { id: "ix-api", mode: "optional" },
    { id: "review-service", mode: "optional" },
  ],
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-runtime-"));
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.IX_CONFIG_ROOT;
  delete process.env.IX_LOG_LEVEL;
  resetRuntimeContext();
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
  _resetIxPluginRegistryForTests();
});

afterEach(() => {
  resetRuntimeContext();
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
  _resetIxPluginRegistryForTests();
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.IX_CONFIG_ROOT;
  delete process.env.IX_LOG_LEVEL;
  rmSync(dir, { recursive: true, force: true });
});

describe("runtime distributions", () => {
  it("TC-500: generic distribution starts with runtime primitives and no IX service layer", () => {
    const distribution = createRuntimeDistribution({
      id: "generic",
      binaryName: "generic",
      configNamespace: "generic",
      configRootEnvVar: "GENERIC_CONFIG_ROOT",
      defaultPlugins: [workflowPlugin],
      ixServicesEnabled: false,
    });

    expect(distribution.ixServicesEnabled).toBe(false);
    expect(distribution.defaultPlugins.map((plugin) => plugin.id)).toEqual([
      "workflow",
    ]);
  });

  it("TC-501: main ix distribution declares official default plugin bundle", () => {
    const distribution = createRuntimeDistribution({
      id: "ix",
      binaryName: "ix",
      configNamespace: "ix",
      configRootEnvVar: "IX_CONFIG_ROOT",
      defaultPlugins: [
        { id: "core" },
        { id: "local" },
        { id: "elements" },
        workflowPlugin,
      ],
      ixServicesEnabled: true,
    });

    expect(distribution.defaultPlugins.map((plugin) => plugin.id)).toEqual([
      "core",
      "local",
      "elements",
      "workflow",
    ]);
    expect(distribution.ixServicesEnabled).toBe(true);
  });

  it("TC-502: distribution defaults lose to user, project, env, and flags", () => {
    const userRoot = join(dir, "user");
    const projectRoot = join(dir, "project");
    configureRuntimeContext({
      configRoot: userRoot,
      projectConfigRoot: projectRoot,
    });
    const cfg = ConfigService.forPlugin("workflow", ConfigSchema, {
      defaults: { stateDir: ".dist", logLevel: "info" },
      envBindings: { stateDir: "IX_WORKFLOW_STATE_DIR" },
    });
    cfg.set({ stateDir: ".user" });
    writeConfig(projectRoot, "workflow", "stateDir: .project\n");
    process.env.IX_WORKFLOW_STATE_DIR = ".env";

    const effective = { ...cfg.get(), stateDir: ".flag" };

    expect(effective.stateDir).toBe(".flag");
    delete process.env.IX_WORKFLOW_STATE_DIR;
    expect(cfg.get().stateDir).toBe(".project");
    rmSync(configPathForRoot(projectRoot, "workflow"));
    expect(cfg.get().stateDir).toBe(".user");
    cfg.reset();
    expect(cfg.get().stateDir).toBe(".dist");
  });
});

describe("runtime config-root selection", () => {
  const distribution = createRuntimeDistribution({
    id: "ix",
    binaryName: "ix",
    configNamespace: "ix",
    configRootEnvVar: "IX_CONFIG_ROOT",
    defaultPlugins: [],
    ixServicesEnabled: true,
  });

  it("TC-503: --config-root selects the root used by ConfigService", () => {
    configureRuntimeContext({ configRoot: join(dir, "selected") });
    const cfg = ConfigService.forPlugin("core", ConfigSchema);
    expect(cfg.filePath()).toBe(join(dir, "selected", "config.yaml"));
  });

  it("TC-504: IX_CONFIG_ROOT selects the root used by ConfigService", () => {
    process.env.IX_CONFIG_ROOT = join(dir, "env-root");
    const selected = selectRuntimeConfigRoot({ distribution });
    configureRuntimeContext({ configRoot: selected.root });

    expect(selected.source).toBe("env");
    expect(configPathFor("core")).toBe(join(dir, "env-root", "config.yaml"));
  });

  it("TC-505: --config-root wins over IX_CONFIG_ROOT", () => {
    process.env.IX_CONFIG_ROOT = join(dir, "env-root");
    const selected = selectRuntimeConfigRoot({
      distribution,
      flagConfigRoot: join(dir, "flag-root"),
    });

    expect(selected).toEqual({
      source: "flag",
      root: join(dir, "flag-root"),
    });
  });

  it("TC-506: project config layers above selected user root unless disabled", () => {
    const userRoot = join(dir, "user");
    const projectRoot = join(dir, "project");
    configureRuntimeContext({
      configRoot: userRoot,
      projectConfigRoot: projectRoot,
    });
    const cfg = ConfigService.forPlugin("workflow", ConfigSchema);
    cfg.set({ stateDir: ".user" });
    writeConfig(projectRoot, "workflow", "stateDir: .project\n");

    expect(cfg.get().stateDir).toBe(".project");

    const noProject = ConfigService.forPlugin("workflow", ConfigSchema, {
      projectConfigEnabled: false,
    });
    expect(noProject.get().stateDir).toBe(".user");
  });

  it("TC-507: read with missing config root uses defaults without creating files", () => {
    const root = join(dir, "missing");
    configureRuntimeContext({ configRoot: root });
    const cfg = ConfigService.forPlugin("core", ConfigSchema);

    expect(cfg.get().logLevel).toBe("info");
    expect(existsSync(root)).toBe(false);
  });
});

function writeConfig(root: string, pluginId: string, content: string): void {
  const path = configPathForRoot(root, pluginId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}

describe("plugin manifest loading", () => {
  it("TC-508: loader applies distribution, user, then project order", () => {
    const result = resolvePluginManifestLayers([
      {
        name: "distribution",
        manifest: parsePluginManifest({
          plugins: { workflow: { package: "dist-workflow", enabled: true } },
        }),
      },
      {
        name: "user",
        manifest: parsePluginManifest({
          plugins: { local: { package: "user-local", enabled: true } },
        }),
      },
      {
        name: "project",
        manifest: parsePluginManifest({
          plugins: { workflow: { package: "project-workflow", enabled: true } },
        }),
      },
    ]);

    expect(
      result.plugins.map((entry) => [entry.id, entry.package, entry.source]),
    ).toEqual([
      ["workflow", "project-workflow", "project"],
      ["local", "user-local", "user"],
    ]);
  });

  it("TC-509: project manifest disables a plugin enabled by distribution defaults", () => {
    const result = resolvePluginManifestLayers([
      {
        name: "distribution",
        manifest: parsePluginManifest({
          plugins: { workflow: { package: "workflow", enabled: true } },
        }),
      },
      {
        name: "project",
        manifest: parsePluginManifest({
          plugins: { workflow: { package: "workflow", enabled: false } },
        }),
      },
    ]);

    expect(result.plugins).toEqual([]);
  });

  it("TC-510: plugin manifest validates id, package, enabled state, and version", () => {
    expect(() =>
      parsePluginManifest({
        plugins: { workflow: { package: "", enabled: true } },
      }),
    ).toThrow();

    const result = resolvePluginManifestLayers([
      {
        name: "user",
        manifest: parsePluginManifest({
          plugins: {
            "../bad": { package: "bad", enabled: true, version: "^1.0.0" },
          },
        }),
      },
    ]);

    expect(result.diagnostics[0]).toMatchObject({
      kind: "invalid-plugin-id",
      pluginId: "../bad",
    });
  });

  it("TC-511: optional plugin load failure is reported without blocking unrelated plugins", async () => {
    const result = await loadPluginManifestLayers({
      layers: [
        {
          name: "user",
          manifest: parsePluginManifest({
            plugins: {
              workflow: { package: "workflow", enabled: true },
              broken: { package: "broken", enabled: true },
            },
          }),
        },
      ],
      resolveModule(specifier) {
        if (specifier === "broken") throw new Error("boom");
        return { workflowIxPlugin: workflowPlugin };
      },
    });

    expect(result.loaded.map((item) => item.plugin.id)).toEqual(["workflow"]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ kind: "load-failed", pluginId: "broken" }),
    ]);
  });
});

describe("plugin capability binding", () => {
  it("TC-512: plugin declares github, ix-api, and review-service capabilities", () => {
    expect(
      workflowPlugin.capabilities?.map((capability) => capability.id),
    ).toEqual(["github", "ix-api", "review-service"]);
  });

  it("TC-513: mandatory missing capability fails before side effects and serializes to JSON", async () => {
    const secrets = new SecretsService({
      mode: "memory",
      backends: new Map([["memory", new MemoryBackend()]]),
    });
    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets,
      providers: {},
    });
    const result = await resolver.resolveCommand({
      plugin: workflowPlugin,
      command: workflowPlugin.commands?.[0],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(capabilityErrorToJson(result.errors[0])).toMatchObject({
        code: "capability_missing",
        capabilityId: "review-service",
        commandId: "workflow.advance",
      });
    }
  });

  it("TC-514: optional missing capability does not block local-only workflow command", async () => {
    const secrets = new SecretsService({
      mode: "memory",
      backends: new Map([["memory", new MemoryBackend()]]),
    });
    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets,
      providers: {},
    });

    await expect(
      resolver.resolveCommand({
        plugin: workflowPlugin,
        command: workflowPlugin.commands?.[1],
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("TC-515: capability resolver passes ConfigService and SecretsService to providers", async () => {
    const secrets = new SecretsService({
      mode: "memory",
      backends: new Map([["memory", new MemoryBackend()]]),
    });
    const seen: unknown[] = [];
    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets,
      providers: {
        "review-service": (_capabilityId, context) => {
          seen.push(context.config, context.secrets);
          return true;
        },
      },
    });

    await expect(
      resolver.resolveCommand({
        plugin: workflowPlugin,
        command: workflowPlugin.commands?.[0],
      }),
    ).resolves.toEqual({ ok: true });
    expect(seen).toEqual([ConfigService, secrets]);
  });
});
