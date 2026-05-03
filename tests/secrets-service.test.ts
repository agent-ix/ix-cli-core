import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertValidSecretId,
  InvalidSecretIdError,
  isValidSecretId,
  KeyringUnavailableError,
  MemoryBackend,
  registerSecretsForPlugin,
  SecretBackendImmutableError,
  SecretsService,
  splitSecretId,
  UnknownSecretError,
} from "../src/index.js";
import { _resetSecretsRegistryForTests } from "../src/secrets/registry.js";

beforeEach(() => {
  _resetSecretsRegistryForTests();
});

afterEach(() => {
  _resetSecretsRegistryForTests();
});

describe("SecretId validation — FR-014-AC-8", () => {
  it("accepts well-formed ids", () => {
    expect(isValidSecretId("local.ghcr-token")).toBe(true);
    expect(isValidSecretId("core.auth-access-token")).toBe(true);
    expect(isValidSecretId("a1.b2")).toBe(true);
  });

  it("rejects malformed ids enumerated in the spec", () => {
    for (const bad of [
      "",
      ".",
      ".x",
      "x.",
      "A.b",
      "a.B",
      "a..b",
      "a.b.c",
      "a/b.c",
      "1foo.bar",
      "foo.1bar",
    ]) {
      expect(isValidSecretId(bad)).toBe(false);
    }
  });

  it("assertValidSecretId throws InvalidSecretIdError on mismatch, including the id", () => {
    let err: unknown;
    try {
      assertValidSecretId("a..b");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InvalidSecretIdError);
    expect((err as InvalidSecretIdError).id).toBe("a..b");
  });

  it("splitSecretId returns plugin + name", () => {
    expect(splitSecretId("local.ghcr-token")).toEqual({
      pluginId: "local",
      name: "ghcr-token",
    });
  });
});

describe("SecretsService — FR-014 resolution order", () => {
  function newService(env: Record<string, string | undefined> = {}) {
    const memory = new MemoryBackend("keyring"); // pose as keyring for which() tests
    const backends = new Map([["keyring", memory]]);
    const svc = new SecretsService({ mode: "keyring", backends, env });
    return { svc, memory };
  }

  it("AC-1: env beats backend", async () => {
    registerSecretsForPlugin("local", [
      {
        name: "ghcr-token",
        description: "GHCR PAT",
        envVar: "IX_GHCR_TOKEN",
      },
    ]);
    const { svc, memory } = newService({ IX_GHCR_TOKEN: "from-env" });
    await memory.set("local.ghcr-token", "from-keyring");
    expect(await svc.get("local.ghcr-token")).toBe("from-env");
    expect(await svc.which("local.ghcr-token")).toBe("env");
  });

  it("AC-2: backend wins when env unset", async () => {
    registerSecretsForPlugin("local", [
      {
        name: "ghcr-token",
        description: "GHCR PAT",
        envVar: "IX_GHCR_TOKEN",
      },
    ]);
    const { svc, memory } = newService({});
    await memory.set("local.ghcr-token", "from-keyring");
    expect(await svc.get("local.ghcr-token")).toBe("from-keyring");
    expect(await svc.which("local.ghcr-token")).toBe("keyring");
  });

  it("AC-4: returns null when no env and no backend value", async () => {
    registerSecretsForPlugin("local", [
      { name: "ghcr-token", description: "GHCR PAT" },
    ]);
    const { svc } = newService({});
    expect(await svc.get("local.ghcr-token")).toBeNull();
    expect(await svc.which("local.ghcr-token")).toBe("unset");
  });

  it("AC-5: set then delete → which() === unset", async () => {
    registerSecretsForPlugin("foo", [{ name: "bar", description: "test" }]);
    const { svc } = newService({});
    await svc.set("foo.bar", "v");
    expect(await svc.which("foo.bar")).toBe("keyring");
    await svc.delete("foo.bar");
    expect(await svc.which("foo.bar")).toBe("unset");
  });

  it("AC-6: set throws SecretBackendImmutableError when env is set", async () => {
    registerSecretsForPlugin("local", [
      {
        name: "ghcr-token",
        description: "GHCR PAT",
        envVar: "IX_GHCR_TOKEN",
      },
    ]);
    const { svc } = newService({ IX_GHCR_TOKEN: "shadow" });
    await expect(svc.set("local.ghcr-token", "v")).rejects.toBeInstanceOf(
      SecretBackendImmutableError,
    );
  });

  it("AC-8: get/set/delete reject malformed SecretId with InvalidSecretIdError", async () => {
    const { svc } = newService({});
    await expect(svc.get("..")).rejects.toBeInstanceOf(InvalidSecretIdError);
    await expect(svc.set("..", "x")).rejects.toBeInstanceOf(
      InvalidSecretIdError,
    );
    await expect(svc.delete("..")).rejects.toBeInstanceOf(InvalidSecretIdError);
    await expect(svc.which("..")).rejects.toBeInstanceOf(InvalidSecretIdError);
  });
});

describe("SecretsService — backend selection", () => {
  it("auto: keyring picked when its probe succeeds", async () => {
    const keyring = new MemoryBackend("keyring");
    const ageFile = new MemoryBackend("age-file");
    const svc = new SecretsService({
      mode: "auto",
      backends: new Map([
        ["keyring", keyring],
        ["age-file", ageFile],
      ]),
      env: {},
    });
    expect(await svc.activeBackendId()).toBe("keyring");
  });

  it("auto: falls through to age-file when keyring probe fails", async () => {
    const keyring = new MemoryBackend("keyring");
    keyring.setAvailability(false);
    const ageFile = new MemoryBackend("age-file");
    const svc = new SecretsService({
      mode: "auto",
      backends: new Map([
        ["keyring", keyring],
        ["age-file", ageFile],
      ]),
      env: {},
    });
    expect(await svc.activeBackendId()).toBe("age-file");
  });

  it("pinned keyring + failing probe → KeyringUnavailableError on every op (NFR-006-AC-5)", async () => {
    const keyring = new MemoryBackend("keyring");
    keyring.setAvailability(false);
    const svc = new SecretsService({
      mode: "keyring",
      backends: new Map([["keyring", keyring]]),
      env: {},
    });
    registerSecretsForPlugin("foo", [{ name: "bar", description: "test" }]);
    await expect(svc.get("foo.bar")).rejects.toBeInstanceOf(
      KeyringUnavailableError,
    );
    await expect(svc.set("foo.bar", "v")).rejects.toBeInstanceOf(
      KeyringUnavailableError,
    );
    await expect(svc.delete("foo.bar")).rejects.toBeInstanceOf(
      KeyringUnavailableError,
    );
  });

  it("pinned age-file: succeeds even if keyring is unavailable", async () => {
    const keyring = new MemoryBackend("keyring");
    keyring.setAvailability(false);
    const ageFile = new MemoryBackend("age-file");
    const svc = new SecretsService({
      mode: "age-file",
      backends: new Map([
        ["keyring", keyring],
        ["age-file", ageFile],
      ]),
      env: {},
    });
    registerSecretsForPlugin("foo", [{ name: "bar", description: "test" }]);
    await svc.set("foo.bar", "v");
    expect(await svc.get("foo.bar")).toBe("v");
  });
});

describe("SecretsService.list — FR-019-AC-1 never renders values", () => {
  it("returns one row per declared secret with backend + source columns, no value", async () => {
    registerSecretsForPlugin("local", [
      { name: "ghcr-token", description: "GHCR PAT" },
    ]);
    registerSecretsForPlugin("core", [
      { name: "auth-refresh-token", description: "IX refresh" },
    ]);
    const memory = new MemoryBackend("keyring");
    const svc = new SecretsService({
      mode: "keyring",
      backends: new Map([["keyring", memory]]),
      env: {},
    });
    await svc.set("local.ghcr-token", "secret-value-do-not-leak");
    const rows = await svc.list();
    expect(rows.length).toBe(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(["core.auth-refresh-token", "local.ghcr-token"]); // sorted
    for (const row of rows) {
      // The shape MUST NOT carry a `value` property.
      expect(Object.keys(row)).toEqual([
        "id",
        "backend",
        "source",
        "description",
      ]);
    }
    expect(rows.find((r) => r.id === "local.ghcr-token")?.source).toBe(
      "keyring",
    );
    expect(rows.find((r) => r.id === "core.auth-refresh-token")?.source).toBe(
      "unset",
    );
  });
});

describe("SecretsService.assertRegistered — FR-019-AC-5 unknown id handling", () => {
  it("throws UnknownSecretError listing registered ids", () => {
    registerSecretsForPlugin("local", [
      { name: "ghcr-token", description: "x" },
    ]);
    let err: unknown;
    try {
      SecretsService.assertRegistered("local.unknown");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnknownSecretError);
    expect((err as UnknownSecretError).registered).toContain(
      "local.ghcr-token",
    );
  });

  it("does not throw for a registered id", () => {
    registerSecretsForPlugin("local", [
      { name: "ghcr-token", description: "x" },
    ]);
    expect(() =>
      SecretsService.assertRegistered("local.ghcr-token"),
    ).not.toThrow();
  });
});

describe("Backend pluggability — NFR-006-AC-1", () => {
  it("a custom backend registered through the constructor map flows end-to-end", async () => {
    class CustomBackend extends MemoryBackend {
      constructor() {
        super("custom");
      }
    }
    const custom = new CustomBackend();
    const svc = new SecretsService({
      mode: "custom",
      backends: new Map([["custom", custom]]),
      env: {},
    });
    registerSecretsForPlugin("foo", [{ name: "bar", description: "x" }]);
    await svc.set("foo.bar", "value");
    expect(await svc.get("foo.bar")).toBe("value");
    expect(await svc.activeBackendId()).toBe("custom");
  });
});
