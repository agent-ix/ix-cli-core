import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AgeFileBackend,
  SecretsBlobCorruptedError,
  SecretsIdentityPermissionsError,
} from "../src/index.js";

let dir: string;
let backend: AgeFileBackend;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-age-"));
  backend = new AgeFileBackend(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AgeFileBackend — FR-016-AC-1 file creation", () => {
  it("creates secrets.d/<plugin>.age (mode 0o600) and secrets.key (mode 0o600) on first set", async () => {
    await backend.set("local.ghcr-token", "ghp_TEST_DO_NOT_LEAK_0123456789");
    const blobPath = join(dir, "secrets.d", "local.age");
    const idPath = join(dir, "secrets.key");
    expect(existsSync(blobPath)).toBe(true);
    expect(existsSync(idPath)).toBe(true);
    expect(statSync(blobPath).mode & 0o777).toBe(0o600);
    expect(statSync(idPath).mode & 0o777).toBe(0o600);
  });
});

describe("AgeFileBackend — FR-016-AC-2a blob does not contain plaintext", () => {
  it("leak scan: ciphertext bytes do not include the plaintext value", async () => {
    const value = "ghp_LEAK_SCAN_VALUE_01234567890123456789";
    await backend.set("local.ghcr-token", value);
    const blobPath = join(dir, "secrets.d", "local.age");
    const cipher = readFileSync(blobPath);
    expect(cipher.includes(Buffer.from(value, "utf8"))).toBe(false);
    // Round-trip recovers the value (sanity).
    expect(await backend.get("local.ghcr-token")).toBe(value);
  });
});

describe("AgeFileBackend — FR-016-AC-2b identity file is well-formed", () => {
  it("secrets.key is exactly one AGE-SECRET-KEY-1 line + \\n, no extra content", async () => {
    await backend.set("local.ghcr-token", "anything");
    const idPath = join(dir, "secrets.key");
    const text = readFileSync(idPath, "utf8");
    const lines = text.split("\n");
    expect(lines.length).toBe(2); // single line + trailing newline
    expect(lines[1]).toBe("");
    expect(lines[0].startsWith("AGE-SECRET-KEY-1")).toBe(true);
  });

  it("the identity bytes are NOT a substring of any secret value", async () => {
    const value = "shouldnotappear-1234567890";
    await backend.set("foo.bar", value);
    const idText = readFileSync(join(dir, "secrets.key"), "utf8");
    expect(idText.includes(value)).toBe(false);
  });
});

describe("AgeFileBackend — FR-016-AC-3 corruption isolated to one plugin", () => {
  it("corrupting local.age does not affect elements.age", async () => {
    await backend.set("local.ghcr-token", "v1");
    await backend.set("elements.api-key", "v2");
    const localBlob = join(dir, "secrets.d", "local.age");
    // Modify the last 16 bytes (the AEAD tag) to force decryption failure.
    const buf = readFileSync(localBlob);
    for (let i = buf.length - 16; i < buf.length; i++) buf[i] ^= 0xff;
    writeFileSync(localBlob, buf, { mode: 0o600 });

    await expect(backend.get("local.ghcr-token")).rejects.toBeInstanceOf(
      SecretsBlobCorruptedError,
    );
    expect(await backend.get("elements.api-key")).toBe("v2");
  });
});

describe("AgeFileBackend — FR-016-AC-5 perm check is exact 0o600", () => {
  for (const mode of [0o644, 0o700, 0o400, 0o620, 0o020] as const) {
    it(`mode 0o${mode.toString(8).padStart(3, "0")} secrets.key → SecretsIdentityPermissionsError`, async () => {
      // Generate identity by running one set; then change perms.
      await backend.set("foo.bar", "x");
      chmodSync(join(dir, "secrets.key"), mode);
      const fresh = new AgeFileBackend(dir);
      await expect(fresh.get("foo.bar")).rejects.toBeInstanceOf(
        SecretsIdentityPermissionsError,
      );
    });
  }

  it("mode exactly 0o600 → loads successfully", async () => {
    await backend.set("foo.bar", "x");
    chmodSync(join(dir, "secrets.key"), 0o600);
    const fresh = new AgeFileBackend(dir);
    expect(await fresh.get("foo.bar")).toBe("x");
  });
});

describe("AgeFileBackend — round-trips and lifecycle", () => {
  it("get on a missing secret returns null", async () => {
    expect(await backend.get("foo.bar")).toBeNull();
  });

  it("set/get/delete cycle for a single plugin", async () => {
    await backend.set("foo.bar", "first");
    expect(await backend.get("foo.bar")).toBe("first");
    await backend.set("foo.bar", "second");
    expect(await backend.get("foo.bar")).toBe("second");
    await backend.delete("foo.bar");
    expect(await backend.get("foo.bar")).toBeNull();
  });

  it("delete of last secret in a plugin removes the .age file", async () => {
    await backend.set("foo.bar", "x");
    expect(existsSync(join(dir, "secrets.d", "foo.age"))).toBe(true);
    await backend.delete("foo.bar");
    expect(existsSync(join(dir, "secrets.d", "foo.age"))).toBe(false);
  });

  it("multiple secrets within one plugin coexist in a single blob", async () => {
    await backend.set("local.alpha", "1");
    await backend.set("local.beta", "2");
    expect(await backend.get("local.alpha")).toBe("1");
    expect(await backend.get("local.beta")).toBe("2");
    const list = await backend.list();
    const ids = list.map((l) => l.secretId).sort();
    expect(ids).toEqual(["local.alpha", "local.beta"]);
  });

  it("list aggregates across plugin blobs", async () => {
    await backend.set("local.x", "1");
    await backend.set("elements.y", "2");
    const list = await backend.list();
    const ids = list.map((l) => l.secretId).sort();
    expect(ids).toEqual(["elements.y", "local.x"]);
  });

  it("FR-016-AC-6: full lifecycle leaves zero plaintext on disk", async () => {
    const v1 = "value-aaaaaaaaaaaaaaaaaa-1";
    const v2 = "value-bbbbbbbbbbbbbbbbbb-2";
    const v3 = "value-cccccccccccccccccc-3";
    await backend.set("local.a", v1);
    await backend.set("local.b", v2);
    await backend.set("elements.c", v3);
    await backend.delete("local.a");

    // Walk every file under `dir` and assert no plaintext substring appears.
    const fs = await import("node:fs");
    const stack = [dir];
    while (stack.length > 0) {
      const next = stack.pop()!;
      const entries = fs.readdirSync(next, { withFileTypes: true });
      for (const e of entries) {
        const p = join(next, e.name);
        if (e.isDirectory()) {
          stack.push(p);
          continue;
        }
        const bytes = fs.readFileSync(p);
        for (const v of [v1, v2, v3]) {
          expect(bytes.includes(Buffer.from(v, "utf8"))).toBe(false);
        }
      }
    }
  });
});

describe("AgeFileBackend — probe", () => {
  it("returns available when root is creatable", async () => {
    const r = await backend.probe();
    expect(r.available).toBe(true);
  });
});
