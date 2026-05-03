import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ConfigSchemaError,
  ConfigService,
  registerSecretsForPlugin,
} from "../src/index.js";
import { _resetSecretsRegistryForTests } from "../src/secrets/registry.js";
import { _resetRegistryForTests } from "../src/config/registry.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-redact-"));
  process.env.XDG_CONFIG_HOME = dir;
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
  _resetRegistryForTests();
  _resetSecretsRegistryForTests();
});

describe("Schema-error redaction — NFR-005-AC-2", () => {
  it("does NOT render the observed value when the failing key is a declared secret", () => {
    // Register a secret named "token" for plugin "demo".
    registerSecretsForPlugin("demo", [
      { name: "token", description: "API token" },
    ]);

    // A schema where `token` happens to be a config field too — shouldn't
    // happen in practice, but the redaction must protect the value if it
    // accidentally does.
    const schema = z
      .object({
        token: z.number(), // intentionally wrong type to force failure
      })
      .strict();

    const cfg = ConfigService.forPlugin("demo", schema);
    const sensitive = "ghp_DO_NOT_LEAK_THIS_VALUE_4242";
    let err: unknown;
    try {
      // Pass the value as the wrong type via raw Zod safeParse path —
      // ConfigService.set goes through schema validation and will throw
      // ConfigSchemaError with our redaction wired in.
      cfg.set({ token: sensitive } as unknown as Partial<{
        token: number;
      }>);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigSchemaError);
    const message = (err as Error).message;
    expect(message).toContain("<redacted>");
    expect(message).not.toContain(sensitive);
  });

  it("non-secret keys do NOT redact their observed value", () => {
    const schema = z
      .object({
        logLevel: z.enum(["debug", "info"]),
      })
      .strict();
    const cfg = ConfigService.forPlugin("demo", schema);
    let err: unknown;
    try {
      cfg.set({ logLevel: "loud" } as unknown as Partial<{
        logLevel: "debug" | "info";
      }>);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigSchemaError);
    // The non-secret error must not be redacted (the redaction path is
    // gated on the secrets registry; `logLevel` is not a registered secret).
    expect((err as Error).message).not.toContain("<redacted>");
    // The error names the key path so users can locate the failure.
    expect((err as Error).message).toContain("logLevel");
  });
});

describe("Schema-error redaction — file-write idempotency", () => {
  it("redaction also applies on the get() incident path (FR-011-AC-1)", async () => {
    const { listIncidents } = await import("../src/index.js");
    registerSecretsForPlugin("demo", [
      { name: "token", description: "secret" },
    ]);
    const schema = z.object({ token: z.number().default(0) }).strict();
    const cfg = ConfigService.forPlugin("demo", schema);

    // Use a valid set first to create the parent dir + a valid file.
    cfg.set({ token: 1 });
    // Now overwrite with a value of the WRONG type that contains a
    // sensitive string. The next get() records a schema incident; the
    // recorded issue must redact the value.
    const sensitive = "tok_LEAKED_INTO_FILE_99";
    writeFileSync(cfg.filePath(), `token: "${sensitive}"\n`, { mode: 0o600 });

    // Trigger get → schema mismatch → recorded incident with redacted value.
    cfg.get();

    const incs = listIncidents().filter((i) => i.pluginId === "demo");
    const last = incs[incs.length - 1];
    expect(last.kind).toBe("schema");
    const renderedValues = (last.issues ?? [])
      .map((i) => i.receivedValue ?? "")
      .join(" ");
    expect(renderedValues).toContain("<redacted>");
    expect(renderedValues).not.toContain(sensitive);
  });
});
