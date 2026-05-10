import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getRegisteredIxPlugin,
  getRegisteredPlugin,
  getRegisteredSecret,
  registerIxPlugin,
  type IxPlugin,
} from "../src/index.js";
import { _resetRegistryForTests } from "../src/config/registry.js";
import { _resetIxPluginRegistryForTests } from "../src/plugins/registry.js";
import { _resetSecretsRegistryForTests } from "../src/secrets/registry.js";

const StrictSchema = z.object({ stateDir: z.string().default(".x") }).strict();
const LooseSchema = z.object({ stateDir: z.string().default(".x") });

beforeEach(() => {
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
  _resetIxPluginRegistryForTests();
});

afterEach(() => {
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
  _resetIxPluginRegistryForTests();
});

describe("IxPlugin command contract", () => {
  it("TC-600: public type supports command and capability fields", () => {
    const plugin: IxPlugin = {
      id: "workflow",
      commands: [
        {
          id: "workflow.create",
          topic: ["workflow", "create"],
          summary: "Create workflow",
          requiredCapabilities: ["filesystem"],
        },
      ],
      capabilities: [
        {
          id: "filesystem",
          mode: "required",
        },
      ],
    };

    expect(plugin.commands?.[0].topic).toEqual(["workflow", "create"]);
    expect(plugin.capabilities?.[0].mode).toBe("required");
  });

  it("TC-601: invalid plugin id registration fails without side effects", () => {
    const result = registerIxPlugin({
      id: "../workflow",
      commands: [],
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "invalid-plugin-id",
    });
    expect(getRegisteredIxPlugin("../workflow")).toBeUndefined();
  });

  it("TC-602: strict config schema registers with env bindings", () => {
    const result = registerIxPlugin({
      id: "workflow",
      configSchema: StrictSchema,
      envBindings: { stateDir: "IX_WORKFLOW_STATE_DIR" },
    });

    expect(result.ok).toBe(true);
    expect(getRegisteredPlugin("workflow")).toMatchObject({
      pluginId: "workflow",
      envBindings: { stateDir: "IX_WORKFLOW_STATE_DIR" },
    });
  });

  it("TC-603: non-strict config schema is rejected", () => {
    const result = registerIxPlugin({
      id: "workflow",
      configSchema: LooseSchema,
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "non-strict-schema",
    });
    expect(getRegisteredPlugin("workflow")).toBeUndefined();
  });

  it("TC-604: secret declarations register under plugin namespace", () => {
    const result = registerIxPlugin({
      id: "workflow",
      secretsSchema: [
        {
          name: "github-token",
          description: "GitHub token",
          envVar: "IX_GITHUB_TOKEN",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(getRegisteredSecret("workflow.github-token")).toMatchObject({
      pluginId: "workflow",
      name: "github-token",
      envVar: "IX_GITHUB_TOKEN",
    });
  });

  it("TC-605: duplicate plugin ids preserve first registration", () => {
    const first = registerIxPlugin({
      id: "workflow",
      commands: [{ id: "a", topic: ["a"], summary: "A" }],
    });
    const second = registerIxPlugin({
      id: "workflow",
      commands: [{ id: "b", topic: ["b"], summary: "B" }],
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, kind: "duplicate-id" });
    expect(getRegisteredIxPlugin("workflow")?.commands).toEqual([
      { id: "a", topic: ["a"], summary: "A" },
    ]);
  });

  it("TC-606: command and capability metadata is retained", () => {
    const result = registerIxPlugin({
      id: "workflow",
      commands: [
        {
          id: "workflow.advance",
          topic: ["workflow", "advance"],
          summary: "Advance workflow",
          requiredCapabilities: ["review-service"],
        },
      ],
      capabilities: [
        {
          id: "review-service",
          mode: "optional",
          description: "Human review service",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(getRegisteredIxPlugin("workflow")).toEqual({
      id: "workflow",
      commands: [
        {
          id: "workflow.advance",
          topic: ["workflow", "advance"],
          summary: "Advance workflow",
          requiredCapabilities: ["review-service"],
        },
      ],
      capabilities: [
        {
          id: "review-service",
          mode: "optional",
          description: "Human review service",
        },
      ],
    });
  });
});
