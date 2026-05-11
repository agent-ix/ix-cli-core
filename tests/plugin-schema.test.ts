import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  getRegisteredPlugin,
  getRegisteredSecret,
  registerPluginSchema,
} from "../src/index.js";
import { _resetRegistryForTests } from "../src/config/registry.js";
import {
  getRegisteredSecret as getSecretFromRegistry,
  _resetSecretsRegistryForTests,
} from "../src/secrets/registry.js";
import { _resetPluginSchemaRegistryForTests } from "../src/plugins/schema.js";

const Schema = z
  .object({ stateDir: z.string().default(".ix/workflows") })
  .strict();

beforeEach(() => {
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
  _resetPluginSchemaRegistryForTests();
});

afterEach(() => {
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
  _resetPluginSchemaRegistryForTests();
});

describe("registerPluginSchema — FR-025 oclif ixSchema convention", () => {
  it("registers ixSchema config and secrets into the runtime registries", () => {
    const result = registerPluginSchema("@agent-ix/workflow-cli-plugin", {
      id: "workflow",
      config: Schema,
      secrets: [
        {
          name: "api-token",
          description: "Workflow API token",
          envVar: "IX_WORKFLOW_API_TOKEN",
        },
      ],
      env: { stateDir: "IX_WORKFLOW_STATE_DIR" },
    });

    expect(result.ok).toBe(true);
    expect(
      getRegisteredPlugin("@agent-ix/workflow-cli-plugin"),
    ).toBeUndefined();
    expect(getRegisteredPlugin("workflow")?.envBindings).toEqual({
      stateDir: "IX_WORKFLOW_STATE_DIR",
    });
    expect(getRegisteredSecret("workflow.api-token")).toEqual(
      getSecretFromRegistry("workflow.api-token"),
    );
  });

  it("derives a safe plugin id from package name when no id is provided", () => {
    const result = registerPluginSchema("@agent-ix/ix-cli-example", {
      config: Schema,
    });

    expect(result.ok).toBe(true);
    expect(getRegisteredPlugin("example")?.schema).toBe(Schema);
  });

  it("rejects non-strict config schemas", () => {
    const result = registerPluginSchema("@agent-ix/loose-plugin", {
      config: z.object({ stateDir: z.string().default(".workflow") }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("non-strict-schema");
    }
    expect(getRegisteredPlugin("loose-plugin")).toBeUndefined();
  });

  it("preserves the first registration on duplicate package names", () => {
    const first = registerPluginSchema("@agent-ix/workflow-cli-plugin", {
      id: "workflow",
      config: Schema,
    });
    const second = registerPluginSchema("@agent-ix/workflow-cli-plugin", {
      id: "workflow-two",
      config: Schema,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.kind).toBe("duplicate-registration");
    }
    expect(getRegisteredPlugin("workflow")?.schema).toBe(Schema);
    expect(getRegisteredPlugin("workflow-two")).toBeUndefined();
  });
});
