import type { SecretId, SecretsBackend } from "../types.js";

/**
 * In-memory backend used by tests and as the reference adapter for
 * NFR-006-AC-1 (third-party backends register through the same interface).
 *
 * Production code should NOT use this — secrets do not persist across
 * processes.
 */
export class MemoryBackend implements SecretsBackend {
  readonly id: string;
  private readonly store = new Map<string, string>();
  private available = true;

  constructor(id: string = "memory") {
    this.id = id;
  }

  setAvailability(available: boolean): void {
    this.available = available;
  }

  async probe(): Promise<{ available: boolean; reason?: string }> {
    return this.available
      ? { available: true }
      : { available: false, reason: "memory backend disabled by test fixture" };
  }

  async get(secretId: SecretId): Promise<string | null> {
    return this.store.get(secretId) ?? null;
  }

  async set(secretId: SecretId, value: string): Promise<void> {
    this.store.set(secretId, value);
  }

  async delete(secretId: SecretId): Promise<void> {
    this.store.delete(secretId);
  }

  async list(): Promise<Array<{ secretId: SecretId }>> {
    return Array.from(this.store.keys()).map((id) => ({
      secretId: id as SecretId,
    }));
  }
}
