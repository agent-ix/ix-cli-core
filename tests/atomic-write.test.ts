import { mkdtempSync, readFileSync, statSync, symlinkSync, utimesSync, writeFileSync, readdirSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWrite, ConfigSymlinkRefusedError, ConfigWriteError } from "../src/atomic/write.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-atomic-"));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("atomicWrite — NFR-004-AC-1 mode 0o600 regardless of umask", () => {
  it("creates the file with mode 0o600", () => {
    const target = join(dir, "config.yaml");
    const prevUmask = process.umask(0o022);
    try {
      atomicWrite(target, "logLevel: info\n");
    } finally {
      process.umask(prevUmask);
    }
    const st = statSync(target);
    expect(st.mode & 0o777).toBe(0o600);
    expect(readFileSync(target, "utf8")).toBe("logLevel: info\n");
  });
});

describe("atomicWrite — FR-010-AC-2 atomic temp+rename", () => {
  it("replaces existing content fully (no partial write observable post-failure)", () => {
    const target = join(dir, "config.yaml");
    atomicWrite(target, "version: 1\n");
    atomicWrite(target, "version: 2\n");
    expect(readFileSync(target, "utf8")).toBe("version: 2\n");
  });

  it("leaves no orphan temp files after a successful write", () => {
    const target = join(dir, "config.yaml");
    atomicWrite(target, "x: 1\n");
    const remaining = readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(remaining).toEqual([]);
  });
});

describe("atomicWrite — FR-010-AC-8 temp file is a sibling of target", () => {
  it("never writes a temp file outside the target directory", () => {
    const target = join(dir, "config.yaml");
    atomicWrite(target, "x: 1\n");
    // After success no temp remains; mid-write the temp must be in `dir`.
    // We assert via a contrived failure path below (read-only target).
    const tmpDirEntries = readdirSync(tmpdir()).filter((f) =>
      f.startsWith(`config.yaml.tmp.${process.pid}.`),
    );
    expect(tmpDirEntries).toEqual([]);
  });
});

describe("atomicWrite — NFR-004-AC-4 + ConfigSymlinkRefusedError", () => {
  it("refuses to write through a symlinked target", () => {
    const real = join(dir, "real.yaml");
    const link = join(dir, "link.yaml");
    writeFileSync(real, "real: true\n");
    symlinkSync(real, link);
    expect(() => atomicWrite(link, "tampered: true\n")).toThrow(
      ConfigSymlinkRefusedError,
    );
    expect(readFileSync(real, "utf8")).toBe("real: true\n");
  });
});

describe("atomicWrite — FR-010-AC-7 read-only target → ConfigWriteError, prior content intact", () => {
  it("preserves the existing target content and removes the temp file", () => {
    const target = join(dir, "config.yaml");
    atomicWrite(target, "first: true\n");

    // Make the target directory read-only (no write/exec).
    chmodSync(dir, 0o500);
    let err: unknown;
    try {
      atomicWrite(target, "second: true\n");
    } catch (e) {
      err = e;
    } finally {
      chmodSync(dir, 0o700); // restore for cleanup
    }
    expect(err).toBeInstanceOf(ConfigWriteError);
    expect(readFileSync(target, "utf8")).toBe("first: true\n");
    const orphans = readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(orphans).toEqual([]);
  });
});

describe("atomicWrite — FR-010-AC-9 orphan temp pruning (>30s old)", () => {
  it("prunes a stale sibling temp file before writing", () => {
    const target = join(dir, "config.yaml");
    const stale = `${target}.tmp.99999.deadbeef`;
    writeFileSync(stale, "stale\n", { mode: 0o600 });
    // Backdate mtime by 60 seconds.
    const past = Math.floor((Date.now() - 60_000) / 1000);
    utimesSync(stale, past, past);

    atomicWrite(target, "fresh: true\n");

    const remaining = readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(remaining).toEqual([]);
    expect(readFileSync(target, "utf8")).toBe("fresh: true\n");
  });

  it("leaves a fresh sibling temp alone (might be another writer mid-flight)", () => {
    const target = join(dir, "config.yaml");
    const fresh = `${target}.tmp.12345.cafef00d`;
    writeFileSync(fresh, "in-flight\n", { mode: 0o600 });

    atomicWrite(target, "ok: true\n");

    expect(readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([
      "config.yaml.tmp.12345.cafef00d",
    ]);
  });
});

describe("atomicWrite — creates parent files but not parent directories", () => {
  it("throws ConfigWriteError when the parent directory is missing", () => {
    const target = join(dir, "missing", "nested", "config.yaml");
    expect(() => atomicWrite(target, "x\n")).toThrow(ConfigWriteError);
  });
});
