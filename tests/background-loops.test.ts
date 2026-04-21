import { describe, test, expect } from "bun:test";
import { SemanticCache } from "../src/cache/SemanticCache";
import { SemanticController } from "../src/controller/SemanticController";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";
import { InMemoryQueue, randomEmbedding, tick } from "./helpers/stubs";

describe("Controller policy loop", () => {
  test("fires compact() on the configured interval", async () => {
    const cache = new SemanticCache({ maxBytes: 1024 * 1024 });
    const embedder = new HashEmbedder(64);
    for (let i = 0; i < 40; i++) {
      cache.set({
        content: "x".repeat(100),
        embedding: await embedder.embed(`seed-${i}`),
        importance: 1,
      });
    }
    const controller = new SemanticController({
      cache,
      embedder,
      policyMaxBytes: 1_000,
      policyIntervalMs: 20,
      evictFraction: 0.1,
      candidatePoolFraction: 1,
    });
    try {
      const before = cache.count();
      await tick(90);
      expect(cache.count()).toBeLessThan(before);
    } finally {
      await controller.close();
      await cache.close();
    }
  });

  test("does nothing when cache is below policyMaxBytes", async () => {
    const cache = new SemanticCache();
    const embedder = new HashEmbedder(64);
    const controller = new SemanticController({
      cache,
      embedder,
      policyMaxBytes: 100 * 1024 * 1024,
      policyIntervalMs: 15,
    });
    try {
      cache.set({
        content: "only-entry",
        embedding: await embedder.embed("only-entry"),
      });
      await tick(60);
      expect(cache.count()).toBe(1);
    } finally {
      await controller.close();
      await cache.close();
    }
  });
});

describe("Cache sync loop", () => {
  test("ticks drain dirty rows even without user action", async () => {
    const queue = new InMemoryQueue();
    const cache = new SemanticCache({ queue, syncPollMs: 15 });
    try {
      cache.set({
        content: "dirty",
        embedding: randomEmbedding(16, 1),
      });
      cache.set({
        content: "also-dirty",
        embedding: randomEmbedding(16, 2),
      });
      await tick(60);
      expect(queue.batches.flat().length).toBeGreaterThanOrEqual(2);
    } finally {
      await cache.close();
    }
  });
});
