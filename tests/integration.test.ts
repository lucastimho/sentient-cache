import { describe, test, expect } from "bun:test";
import { SemanticCache } from "../src/cache/SemanticCache";
import { SemanticController } from "../src/controller/SemanticController";
import { SessionRegistry } from "../src/controller/SessionRegistry";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";
import { createIngestorApp } from "../src/ingestor/app";
import { InMemoryQueue, InMemoryRemoteStore, randomEmbedding, tick } from "./helpers/stubs";

function jsonPost(path: string, body: unknown): Request {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function boot(opts: { queue?: InMemoryQueue; remote?: InMemoryRemoteStore } = {}) {
  const cache = new SemanticCache({
    queue: opts.queue,
    remote: opts.remote,
    syncPollMs: 20,
  });
  const embedder = new HashEmbedder(64);
  const controller = new SemanticController({
    cache,
    embedder,
    policyIntervalMs: 1_000_000,
    prefetchK: 5,
  });
  const registry = new SessionRegistry();
  const app = createIngestorApp({ controller, registry });
  const teardown = async () => {
    await controller.close();
    await cache.close();
  };
  return { cache, controller, registry, app, teardown };
}

describe("HTTP → Controller → Cache → Queue → Worker → Remote", () => {
  test("a single ingested memory reaches the remote store via the write-behind path", async () => {
    const queue = new InMemoryQueue();
    const remote = new InMemoryRemoteStore();
    const { app, cache, teardown } = boot({ queue, remote });
    try {
      const res = await app.request(
        jsonPost("/ingest", { content: "critical rotation note", importance: 9 }),
      );
      const { id } = (await res.json()) as { id: string };

      await tick(60);
      const enqueuedIds = queue.batches.flat();
      expect(enqueuedIds).toContain(id);

      const toSync = cache.readDirtyMemories(enqueuedIds);
      await remote.writeBatch(toSync);
      cache.markSynced(toSync.map((m) => m.id));

      expect(remote.writeCalls).toHaveLength(1);
      const pushed = remote.writeCalls[0]!.find((m) => m.id === id);
      expect(pushed).toBeDefined();
      expect(pushed!.importance).toBe(9);
      expect(pushed!.content).toBe("critical rotation note");
    } finally {
      await teardown();
    }
  });

  test("many ingests round-trip through a simulated sync worker", async () => {
    const queue = new InMemoryQueue();
    const remote = new InMemoryRemoteStore();
    const { app, cache, teardown } = boot({ queue, remote });
    try {
      for (let i = 0; i < 25; i++) {
        await app.request(jsonPost("/ingest", { content: `doc-${i}` }));
      }
      await tick(80);
      const drained = new Set(queue.batches.flat());
      expect(drained.size).toBe(25);

      const mems = cache.readDirtyMemories([...drained]);
      await remote.writeBatch(mems);
      cache.markSynced(mems.map((m) => m.id));
      expect(remote.writeCalls.flat()).toHaveLength(25);
    } finally {
      await teardown();
    }
  });
});

describe("Task change → Refresh-Ahead → Remote pgvector fetch → local insert", () => {
  test("POST /sessions/:id/task populates local cache with top-K remote memories", async () => {
    const remote = new InMemoryRemoteStore();
    remote.fetchResult = Array.from({ length: 5 }, (_, i) => ({
      id: `archive-${i}`,
      content: `historical memory ${i}`,
      embedding: randomEmbedding(64, i + 100),
      createdAt: Date.now() - 10_000,
      lastAccessedAt: Date.now() - 10_000,
      accessCount: 3,
      sizeBytes: 200,
      partition: "archive" as const,
      importance: 2,
    }));
    const { app, cache, teardown } = boot({ remote });
    try {
      const res = await app.request(
        jsonPost("/sessions/s1/task", { current_task: "react component lifecycle" }),
      );
      expect(res.status).toBe(200);

      await tick(80);
      expect(remote.fetchCalls.length).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < 5; i++) {
        const found = cache.get(`archive-${i}`);
        expect(found).not.toBeNull();
        expect(found!.partition).toBe("archive");
      }
    } finally {
      await teardown();
    }
  });

  test("independent sessions fire independent prefetches for distinct tasks", async () => {
    const remote = new InMemoryRemoteStore();
    const { app, registry, teardown } = boot({ remote });
    try {
      await app.request(jsonPost("/sessions/alice/task", { current_task: "coding" }));
      await app.request(jsonPost("/sessions/bob/task", { current_task: "baking" }));
      await tick(40);

      expect(remote.fetchCalls.length).toBe(2);
      expect(registry.getTask("alice")).toBe("coding");
      expect(registry.getTask("bob")).toBe("baking");
    } finally {
      await teardown();
    }
  });
});

describe("Full orchestrator smoke test", () => {
  test("ingest + search + prefetch + compaction all interoperate on one controller", async () => {
    const remote = new InMemoryRemoteStore();
    remote.fetchResult = [
      {
        id: "seed",
        content: "seed from central store",
        embedding: randomEmbedding(64, 777),
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
        sizeBytes: 200,
        partition: "archive",
        importance: 1,
      },
    ];
    const cache = new SemanticCache({ remote, maxBytes: 4 * 1024 });
    const embedder = new HashEmbedder(64);
    const controller = new SemanticController({
      cache,
      embedder,
      policyIntervalMs: 1_000_000,
      policyMaxBytes: 2 * 1024,
      evictFraction: 0.2,
      candidatePoolFraction: 1,
      prefetchK: 1,
    });
    try {
      for (let i = 0; i < 30; i++) {
        await controller.ingest({ content: `note-${i}`, importance: 1 });
      }
      const hits = await controller.search("note-3", 3);
      expect(hits.length).toBe(3);

      await controller.prefetchForTask("refactoring legacy code");
      await tick(30);
      expect(cache.get("seed")).not.toBeNull();

      const before = cache.count();
      controller.compact();
      expect(cache.count()).toBeLessThanOrEqual(before);
      expect(cache.size()).toBeLessThanOrEqual(4 * 1024);
    } finally {
      await controller.close();
      await cache.close();
    }
  });
});
