import { describe, expect, it } from "vitest";

import { ConfigService } from "../src/config/service.js";
import {
  createCapabilityResolver,
  type CapabilityError,
} from "../src/runtime/capabilities.js";
import { MemoryBackend } from "../src/secrets/backends/memory.js";
import { SecretsService } from "../src/secrets/service.js";

function secrets(): SecretsService {
  return new SecretsService({
    mode: "keyring",
    backends: new Map([["keyring", new MemoryBackend("keyring")]]),
  });
}

describe("CapabilityResolver — FR-024", () => {
  it("fails required capabilities that have no provider", async () => {
    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets: secrets(),
      providers: {},
    });

    const result = await resolver.resolveCommand({
      capabilities: { required: ["github"] },
      packageName: "workflow",
      commandId: "workflow.status",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        {
          kind: "capability_missing",
          capabilityId: "github",
          packageName: "workflow",
          commandId: "workflow.status",
          detail: "capability github is not available",
        },
      ]);
    }
    expect(result.availableCapabilities).toEqual([]);
  });

  it("does not block on missing optional capabilities", async () => {
    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets: secrets(),
      providers: {},
    });

    const result = await resolver.resolveCommand({
      capabilities: { optional: ["github"] },
      packageName: "workflow",
      commandId: "workflow.status",
    });

    expect(result).toEqual({ ok: true, availableCapabilities: [] });
  });

  it("surfaces available required and optional capabilities", async () => {
    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets: secrets(),
      providers: {
        github: () => true,
        "review-service": () => true,
      },
    });

    const result = await resolver.resolveCommand({
      capabilities: {
        required: ["github"],
        optional: ["review-service", "ix-api"],
      },
    });

    expect(result).toEqual({
      ok: true,
      availableCapabilities: ["github", "review-service"],
    });
  });

  it("preserves provider errors for unavailable required capabilities", async () => {
    const error: CapabilityError = {
      kind: "capability_auth_missing",
      capabilityId: "github",
      detail: "missing token",
    };
    const resolver = createCapabilityResolver({
      config: ConfigService,
      secrets: secrets(),
      providers: {
        github: () => error,
      },
    });

    const result = await resolver.resolveCommand({
      capabilities: { required: ["github"] },
      packageName: "workflow",
      commandId: "workflow.status",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        {
          ...error,
          packageName: "workflow",
          commandId: "workflow.status",
        },
      ]);
    }
  });
});
