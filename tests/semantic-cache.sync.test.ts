import { describe, test, expect } from "bun:test";
import { SemanticCache } from "../src/cache/SemanticCache";
import { InMemoryQueue, InMemoryRemoteStore, randomEmbedding, tick } from "./helpers/stubs";

describe("Write-behind contract", () => {
  test("set() leaves rows dirty and the poll loop enqueues them", async () => {
    const queue = new InMemoryQueue();
    const cache = new SemanticCache({ queue, syncPollMs: 10 });
    try {
      cache.set({ content: "a", embedding: randomEmbedding(8, 1) });
      cache.set({ content: "b", embedding: randomEmbedding(8, 2) });
      await tick(60);
      const enqueued = queue.batches.flat();
      expect(enqueued.length).toBeGreaterThanOrEqual(2);
    } finally {
      await cache.close();
    }
  });

  test("readDirtyMemories returns committed local rows", async () => {
    const queue = new InMemoryQueue();
    const cache = new SemanticCache({ queue, syncPollMs: 50 });
    try {
      const a = cache.set({ content: "a", embedding: randomEmbedding(4, 1) });
      const b = cache.set({ content: "b", embedding: randomEmbedding(4, 2) });
      const mems = cache.readDirtyMemories([a.id, b.id]);
      expect(mems).toHaveLength(2);
      expect(mems.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    } finally {
      await cache.close();
    }
  });

  test("markSynced stops rows from being re-enqueued", async () => {
    const queue = new InMemoryQueue();
    const cache = new SemanticCache({ queue, syncPollMs: 15 });
    try {
      const a = cache.set({ content: "a", embedding: randomEmbedding(4, 1) });
      await tick(40);
      expect(queue.batches.flat()).toContain(a.id);
      cache.markSynced([a.id]);
      queue.batches.length = 0;
      await tick(50);
      expect(queue.batches.flat()).not.toContain(a.id);
    } finally {
      await cache.close();
    }
  });

  test("queue failure routes to onSyncError rather than throwing", async () => {
    const queue = new InMemoryQueue();
    queue.failEnqueue = true;
    const errors: unknown[] = [];
    const cache = new SemanticCache({
      queue,
      syncPollMs: 10,
      onSyncError: (e) => errors.push(e),
    });
    try {
      cache.set({ content: "a", embedding: randomEmbedding(4, 1) });
      await tick(40);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await cache.close();
    }
  });

  test("set() is synchronous — returns faster than the poll interval", () => {
    const queue = new InMemoryQueue();
    const cache = new SemanticCache({ queue, syncPollMs: 1000 });
    try {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        cache.set({ content: `${i}`, embedding: randomEmbedding(8, i + 1) });
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(500);
    } finally {
      void cache.close();
    }
  });
});

describe("Refresh-ahead contract", () => {
  test("setGoal pre-fetches top-5 from remote and stores them locally", async () => {
    const remote = new InMemoryRemoteStore();
    remote.fetchResult = Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      content: `remote-${i}`,
      embedding: randomEmbedding(8, i + 1),
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      sizeBytes: 128,
      partition: "archive" as const,
      importance: 1,
    }));
    const cache = new SemanticCache({ remote });
    try {
      cache.setGoal(randomEmbedding(8, 99));
      await tick(30);
      expect(remote.fetchCalls).toHaveLength(1);
      expect(remote.fetchCalls[0]!.k).toBe(5);
      for (let i = 0; i < 5; i++) expect(cache.get(`r${i}`)).not.toBeNull();
    } finally {
      await cache.close();
    }
  });

  test("setGoal returns synchronously — does not block on remote", async () => {
    const remote = new InMemoryRemoteStore();
    const cache = new SemanticCache({ remote });
    try {
      const start = performance.now();
      cache.setGoal(randomEmbedding(8, 1));
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5);
    } finally {
      await cache.close();
    }
  });

  test("setGoal without a remote is a local-only operation", () => {
    const cache = new SemanticCache();
    try {
      cache.setGoal(new Float32Array([1, 0, 0]));
      expect(Array.from(cache.goal!)).toEqual([1, 0, 0]);
    } finally {
      void cache.close();
    }
  });

  test("remote fetch failure is captured by onSyncError, not thrown", async () => {
    const remote = new InMemoryRemoteStore();
    remote.failFetch = true;
    const errors: unknown[] = [];
    const cache = new SemanticCache({ remote, onSyncError: (e) => errors.push(e) });
    try {
      cache.setGoal(randomEmbedding(8, 1));
      await tick(20);
      expect(errors).toHaveLength(1);
    } finally {
      await cache.close();
    }
  });

  test("refresh-ahead skips ids already present locally", async () => {
    const remote = new InMemoryRemoteStore();
    const embedding = randomEmbedding(8, 1);
    remote.fetchResult = [
      {
        id: "shared",
        content: "remote-version",
        embedding,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
        sizeBytes: 128,
        partition: "archive",
        importance: 1,
      },
    ];
    const cache = new SemanticCache({ remote });
    try {
      cache.set({ id: "shared", content: "local-version", embedding });
      cache.setGoal(randomEmbedding(8, 2));
      await tick(30);
      expect(cache.get("shared")!.content).toBe("local-version");
    } finally {
      await cache.close();
    }
  });
});

describe("Hot path does no network I/O", () => {
  test("get/set/search work with no remote and no queue configured", () => {
    const cache = new SemanticCache();
    try {
      const m = cache.set({ content: "x", embedding: new Float32Array([1, 0, 0]) });
      expect(cache.get(m.id)).not.toBeNull();
      expect(cache.search(new Float32Array([1, 0, 0]), 1)).toHaveLength(1);
    } finally {
      void cache.close();
    }
  });
});
