import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  KeyringAccessError,
  KeyringBackend,
  KeyringUnavailableError,
} from "../src/index.js";

// ── Mocked module for portable tests ────────────────────────────────────

interface FakeEntry {
  setPassword(v: string): void;
  getPassword(): string;
  deletePassword(): void;
}

class InMemoryStore {
  readonly map = new Map<string, string>();
  failures = new Map<string, string>(); // account → message

  Entry(_service: string, account: string): FakeEntry {
    const map = this.map;
    const failures = this.failures;
    return {
      setPassword(v: string): void {
        const f = failures.get(account);
        if (f) throw new Error(f);
        map.set(account, v);
      },
      getPassword(): string {
        const f = failures.get(account);
        if (f) throw new Error(f);
        const val = map.get(account);
        if (val === undefined) throw new Error("Item not found");
        return val;
      },
      deletePassword(): void {
        const f = failures.get(account);
        if (f) throw new Error(f);
        if (!map.has(account)) throw new Error("Item not found");
        map.delete(account);
      },
    };
  }

  findCredentials(_service: string): Array<{ account: string }> {
    return Array.from(this.map.keys()).map((account) => ({ account }));
  }

  asModule(): {
    Entry: (s: string, a: string) => FakeEntry;
    findCredentials: (s: string) => Array<{ account: string }>;
  } {
    return {
      Entry: (s, a) => this.Entry(s, a),
      findCredentials: (s) => this.findCredentials(s),
    };
  }
}

function makeBackend(store: InMemoryStore): KeyringBackend {
  // Build a minimal module shape acceptable to the backend's constructor.
  const mod = store.asModule();
  // The backend's constructor expects `Entry: new (...) => …`. Emulate with
  // a class that delegates to the closure factory.
  class EntryProxy {
    constructor(s: string, a: string) {
      Object.assign(this, mod.Entry(s, a));
    }
  }
  return new KeyringBackend({
    Entry: EntryProxy as unknown as new (
      service: string,
      account: string,
    ) => FakeEntry,
    findCredentials: mod.findCredentials,
  });
}

describe("KeyringBackend (mocked) — probe + round-trip", () => {
  it("probe succeeds when the round-trip works", async () => {
    const backend = makeBackend(new InMemoryStore());
    const r = await backend.probe();
    expect(r.available).toBe(true);
  });

  it("probe fails when the underlying entry throws", async () => {
    const store = new InMemoryStore();
    store.failures.set("core.__probe__", "Secret Service: not running");
    const backend = makeBackend(store);
    const r = await backend.probe();
    expect(r.available).toBe(false);
    expect(r.reason).toMatch(/Secret Service/);
  });

  it("probe is cached: second call does not retry", async () => {
    const store = new InMemoryStore();
    const backend = makeBackend(store);
    await backend.probe();
    // Force a failure that would only appear on a second probe attempt.
    store.failures.set("core.__probe__", "transient");
    const r = await backend.probe();
    expect(r.available).toBe(true); // cached
  });
});

describe("KeyringBackend (mocked) — get/set/delete", () => {
  it("set then get round-trip", async () => {
    const backend = makeBackend(new InMemoryStore());
    await backend.set("local.ghcr-token", "secret-value");
    expect(await backend.get("local.ghcr-token")).toBe("secret-value");
  });

  it("get on missing entry returns null (FR-014-AC-2 unset path)", async () => {
    const backend = makeBackend(new InMemoryStore());
    expect(await backend.get("local.missing-key")).toBeNull();
  });

  it("delete clears the entry; subsequent get returns null", async () => {
    const backend = makeBackend(new InMemoryStore());
    await backend.set("foo.bar", "x");
    await backend.delete("foo.bar");
    expect(await backend.get("foo.bar")).toBeNull();
  });

  it("delete on missing entry is a no-op", async () => {
    const backend = makeBackend(new InMemoryStore());
    await expect(backend.delete("foo.missing")).resolves.toBeUndefined();
  });

  it("set failure surfaces KeyringAccessError with secret id + cause", async () => {
    const store = new InMemoryStore();
    store.failures.set("local.ghcr-token", "user denied keychain prompt");
    const backend = makeBackend(store);
    let err: unknown;
    try {
      await backend.set("local.ghcr-token", "x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(KeyringAccessError);
    expect((err as KeyringAccessError).secretId).toBe("local.ghcr-token");
    expect((err as Error).message).toMatch(/user denied/);
  });

  it("get failure (non-not-found) surfaces KeyringAccessError", async () => {
    const store = new InMemoryStore();
    store.failures.set("local.ghcr-token", "permission denied");
    const backend = makeBackend(store);
    await expect(backend.get("local.ghcr-token")).rejects.toBeInstanceOf(
      KeyringAccessError,
    );
  });
});

describe("KeyringBackend (mocked) — list filtering", () => {
  it("list returns only well-formed <plugin>.<name> accounts under our service", async () => {
    const store = new InMemoryStore();
    store.map.set("local.ghcr-token", "v");
    store.map.set("elements.api-key", "v");
    store.map.set("garbage", "v"); // missing dot
    store.map.set("Foo.bar", "v"); // uppercase plugin id
    store.map.set("core.__probe__", "v"); // sentinel skipped
    const backend = makeBackend(store);
    const list = await backend.list();
    const ids = list.map((r) => r.secretId).sort();
    expect(ids).toEqual(["elements.api-key", "local.ghcr-token"]);
  });
});

// ── Real-keyring smoke test, gated on capability ────────────────────────

describe("KeyringBackend (REAL @napi-rs/keyring) — smoke round-trip", () => {
  let available = false;
  let backend: KeyringBackend;

  beforeAll(async () => {
    backend = new KeyringBackend();
    const r = await backend.probe();
    available = r.available;
  });

  afterEach(async () => {
    if (!available) return;
    try {
      await backend.delete("ix-cli-test.smoke");
    } catch {
      // best effort
    }
  });

  it.skipIf(!process.env.IX_TEST_KEYRING)(
    "set/get/delete round-trip on the real OS keyring",
    async () => {
      if (!available) {
        // Probe failed (no Secret Service / Keychain locked / etc.).
        // The platform CI matrix (FR-015 verification) is responsible for
        // exercising this on macos-latest and ubuntu-latest with
        // gnome-keyring; locally we skip when unavailable.
        return;
      }
      await backend.set("ix-cli-test.smoke", "round-trip-value");
      expect(await backend.get("ix-cli-test.smoke")).toBe("round-trip-value");
      await backend.delete("ix-cli-test.smoke");
      expect(await backend.get("ix-cli-test.smoke")).toBeNull();
    },
  );
});

describe("KeyringBackend — pinned-mode failure plumbing", () => {
  it("operations on a backend whose probe failed throw KeyringUnavailableError", async () => {
    const store = new InMemoryStore();
    store.failures.set("core.__probe__", "no Secret Service");
    const backend = makeBackend(store);
    await expect(backend.get("foo.bar")).rejects.toBeInstanceOf(
      KeyringUnavailableError,
    );
    await expect(backend.set("foo.bar", "x")).rejects.toBeInstanceOf(
      KeyringUnavailableError,
    );
    await expect(backend.delete("foo.bar")).rejects.toBeInstanceOf(
      KeyringUnavailableError,
    );
  });
});
