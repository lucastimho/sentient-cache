import type { Memory, RemoteStore, WriteBehindQueue } from "../../src/types";

export class InMemoryRemoteStore implements RemoteStore {
  public readonly fetchCalls: Array<{ k: number; embedding: Float32Array }> = [];
  public readonly writeCalls: Memory[][] = [];
  public fetchResult: Memory[] = [];
  public failFetch = false;
  public failWrite = false;

  async fetchTopK(embedding: Float32Array, k: number): Promise<Memory[]> {
    this.fetchCalls.push({ k, embedding });
    if (this.failFetch) throw new Error("fetchTopK failure");
    return this.fetchResult.slice(0, k);
  }

  async writeBatch(memories: Memory[]): Promise<void> {
    if (this.failWrite) throw new Error("writeBatch failure");
    this.writeCalls.push(memories);
  }
}

export class InMemoryQueue implements WriteBehindQueue {
  public readonly batches: string[][] = [];
  public failEnqueue = false;
  public closed = false;

  async enqueueBatch(ids: string[]): Promise<void> {
    if (this.failEnqueue) throw new Error("enqueue failure");
    this.batches.push([...ids]);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export function randomEmbedding(dim: number, seed = 0): Float32Array {
  const out = new Float32Array(dim);
  let s = seed || 1;
  for (let i = 0; i < dim; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return out;
}

export function tick(ms = 30): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function fabricateMemory(overrides: Partial<Memory> = {}): Memory {
  const now = Date.now();
  return {
    id: overrides.id ?? `mem-${Math.random().toString(36).slice(2, 10)}`,
    content: overrides.content ?? "content",
    embedding: overrides.embedding ?? new Float32Array([1, 0, 0]),
    createdAt: overrides.createdAt ?? now,
    lastAccessedAt: overrides.lastAccessedAt ?? now,
    accessCount: overrides.accessCount ?? 0,
    sizeBytes: overrides.sizeBytes ?? 128,
    partition: overrides.partition ?? "working",
    importance: overrides.importance ?? 1.0,
  };
}
