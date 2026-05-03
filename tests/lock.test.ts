import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigLockTimeoutError, withFileLock } from "../src/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ix-lock-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("withFileLock — basic acquire/release", () => {
  it("creates the lockfile during fn, removes it after", () => {
    const lockPath = join(dir, "x.lock");
    let observed = false;
    withFileLock(lockPath, () => {
      observed = existsSync(lockPath);
    });
    expect(observed).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes the lockfile even when fn throws", () => {
    const lockPath = join(dir, "x.lock");
    expect(() =>
      withFileLock(lockPath, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("returns the value produced by fn", () => {
    const lockPath = join(dir, "x.lock");
    const v = withFileLock(lockPath, () => 42);
    expect(v).toBe(42);
  });
});

describe("withFileLock — FR-011-AC-7 timeout → ConfigLockTimeoutError", () => {
  it("times out when an existing lock is held by a running process", () => {
    const lockPath = join(dir, "x.lock");
    // Mark the lock as owned by THIS test's pid (definitely running).
    writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600 });
    expect(() =>
      withFileLock(lockPath, () => {}, { timeoutMs: 100, retryMs: 25 }),
    ).toThrow(ConfigLockTimeoutError);
    // Lock untouched (we did not own it; we did not remove it).
    expect(existsSync(lockPath)).toBe(true);
  });
});

describe("withFileLock — FR-011-AC-6 stale lock from non-running pid is reaped", () => {
  it("reaps a >30s old lock owned by a non-running pid", () => {
    const lockPath = join(dir, "x.lock");
    // Use an extremely high pid that is overwhelmingly likely to not exist.
    writeFileSync(lockPath, `2147480000\n`, { mode: 0o600 });
    // Backdate the lockfile so it's "stale".
    const past = Math.floor((Date.now() - 60_000) / 1000);
    utimesSync(lockPath, past, past);

    let ran = false;
    withFileLock(lockPath, () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("does NOT reap a recent lock even if pid is bogus", () => {
    const lockPath = join(dir, "x.lock");
    writeFileSync(lockPath, `2147480000\n`, { mode: 0o600 });
    // No backdating — lockfile is fresh, so we must wait for timeout.
    expect(() =>
      withFileLock(lockPath, () => {}, { timeoutMs: 100, retryMs: 25 }),
    ).toThrow(ConfigLockTimeoutError);
  });
});
