import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  registerPlugin,
  registerSecret,
  type RegisterResult,
} from "../src/index.js";
import { _resetRegistryForTests } from "../src/config/registry.js";
import { _resetSecretsRegistryForTests } from "../src/secrets/registry.js";

const SchemaA = z.object({ a: z.string().default("x") }).strict();
const SchemaB = z.object({ b: z.string().default("y") }).strict();

beforeEach(() => {
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
});

afterEach(() => {
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
});

describe("registerPlugin — FR-013-AC-3 first-wins", () => {
  it("first call returns kind='registered'", () => {
    const r = registerPlugin({ pluginId: "local", schema: SchemaA });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("registered");
  });

  it("second call with the SAME schema reference is idempotent", () => {
    registerPlugin({ pluginId: "local", schema: SchemaA });
    const r = registerPlugin({ pluginId: "local", schema: SchemaA });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("idempotent");
  });

  it("idempotent path refreshes envBindings without rejecting", () => {
    registerPlugin({ pluginId: "local", schema: SchemaA });
    const r = registerPlugin({
      pluginId: "local",
      schema: SchemaA,
      envBindings: { a: "IX_A" },
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("idempotent");
    if (r.ok) {
      expect(r.entry.envBindings).toEqual({ a: "IX_A" });
    }
  });

  it("second call with a DIFFERENT schema is rejected; first preserved", () => {
    const first = registerPlugin({ pluginId: "local", schema: SchemaA });
    const second = registerPlugin({ pluginId: "local", schema: SchemaB });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.kind).toBe("duplicate-id");
      expect(second.existing.schema).toBe(SchemaA);
      expect(second.attempted.schema).toBe(SchemaB);
    }
  });

  it("preserved registration is the original (not the rejected attempt)", () => {
    registerPlugin({ pluginId: "local", schema: SchemaA });
    registerPlugin({ pluginId: "local", schema: SchemaB });
    // Cross-check via getRegisteredPlugin (also tested elsewhere).
    // The schema reference stored is the first one.
    const r3 = registerPlugin({ pluginId: "local", schema: SchemaA });
    expect(r3.kind).toBe("idempotent");
  });
});

describe("registerSecret — FR-013-AC-3 first-wins for secrets", () => {
  it("first call returns 'registered'", () => {
    const r = registerSecret("local", {
      name: "ghcr-token",
      description: "GHCR PAT",
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("registered");
  });

  it("re-register with structurally identical declaration is idempotent", () => {
    registerSecret("local", {
      name: "ghcr-token",
      description: "GHCR PAT",
      envVar: "IX_GHCR_TOKEN",
    });
    const r = registerSecret("local", {
      name: "ghcr-token",
      description: "GHCR PAT",
      envVar: "IX_GHCR_TOKEN",
    });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("idempotent");
  });

  it("re-register with different description rejects; first preserved", () => {
    const first = registerSecret("local", {
      name: "ghcr-token",
      description: "GHCR PAT",
    });
    const second = registerSecret("local", {
      name: "ghcr-token",
      description: "OTHER",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.existing.description).toBe("GHCR PAT");
      expect(second.attempted.description).toBe("OTHER");
    }
  });

  it("re-register with different envVar rejects", () => {
    registerSecret("local", { name: "x", description: "d", envVar: "A" });
    const r = registerSecret("local", {
      name: "x",
      description: "d",
      envVar: "B",
    });
    expect(r.ok).toBe(false);
  });
});

// Compile-time check: RegisterResult is exported from the public surface.
const _typecheck: RegisterResult | undefined = undefined;
void _typecheck;
