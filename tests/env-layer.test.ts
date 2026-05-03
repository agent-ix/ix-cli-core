import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigService } from "../src/index.js";

const CoreSchema = z
  .object({
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    pool: z
      .object({
        dockerPull: z.coerce.number().int().min(1).default(3),
      })
      .strict()
      .default({ dockerPull: 3 }),
  })
  .strict();

const envBindings = {
  logLevel: "IX_LOG_LEVEL",
  "pool.dockerPull": "IX_POOL_DOCKER_PULL",
} as const;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-env-"));
  process.env.XDG_CONFIG_HOME = dir;
  delete process.env.IX_LOG_LEVEL;
  delete process.env.IX_POOL_DOCKER_PULL;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.IX_LOG_LEVEL;
  delete process.env.IX_POOL_DOCKER_PULL;
  rmSync(dir, { recursive: true, force: true });
});

describe("Env-var layered resolution — FR-012-AC-1 env beats file", () => {
  it("env > file when both set", () => {
    const cfg = ConfigService.forPlugin("core", CoreSchema, { envBindings });
    cfg.set({ logLevel: "info" });
    process.env.IX_LOG_LEVEL = "debug";
    expect(cfg.get().logLevel).toBe("debug");
  });
});

describe("Env-var layered resolution — FR-012-AC-2 file > defaults", () => {
  it("file value wins when env is unset", () => {
    const cfg = ConfigService.forPlugin("core", CoreSchema, { envBindings });
    cfg.set({ logLevel: "warn" });
    expect(cfg.get().logLevel).toBe("warn");
  });
});

describe("Env-var layered resolution — FR-012-AC-3 defaults when env+file absent", () => {
  it("returns schema defaults", () => {
    const cfg = ConfigService.forPlugin("core", CoreSchema, { envBindings });
    expect(cfg.get().logLevel).toBe("info");
    expect(cfg.get().pool.dockerPull).toBe(3);
  });
});

describe("Env-var layered resolution — FR-012-AC-4 invalid env value", () => {
  it("invalid enum value via env → falls back to defaults; incident recorded with kind=schema", async () => {
    const { listIncidents } = await import("../src/index.js");
    const cfg = ConfigService.forPlugin("core", CoreSchema, { envBindings });
    process.env.IX_LOG_LEVEL = "loud"; // not in the enum
    expect(cfg.get().logLevel).toBe("info"); // default
    const incs = listIncidents().filter((i) => i.pluginId === "core");
    expect(incs[incs.length - 1].kind).toBe("schema");
    expect(
      incs[incs.length - 1].issues?.some((it) => it.keyPath === "logLevel"),
    ).toBe(true);
  });
});

describe("Env-var layered resolution — coercion via z.coerce.*", () => {
  it("string '7' from env coerces to number 7 for a number field", () => {
    const cfg = ConfigService.forPlugin("core", CoreSchema, { envBindings });
    process.env.IX_POOL_DOCKER_PULL = "7";
    expect(cfg.get().pool.dockerPull).toBe(7);
  });
});
