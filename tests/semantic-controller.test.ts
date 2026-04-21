import { describe, test, expect } from "bun:test";
import { SemanticCache } from "../src/cache/SemanticCache";
import { SemanticController, type SemanticControllerOptions } from "../src/controller/SemanticController";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";

function makeController(overrides: Partial<SemanticControllerOptions> = {}) {
  const cache = new SemanticCache({ maxBytes: 100 * 1024 * 1024 });
  const embedder = new HashEmbedder(64);
  const controller = new SemanticController({
    cache,
    embedder,
    policyIntervalMs: 1_000_000,
    ...overrides,
  });
  return { cache, embedder, controller };
}

describe("SemanticController.ingest", () => {
  test("embeds, stores, and echoes importance", async () => {
    const { cache, controller } = makeController();
    try {
      const m = await controller.ingest({ content: "plan my trip to Kyoto", importance: 5 });
      expect(cache.get(m.id)!.importance).toBe(5);
      expect(m.embedding.length).toBe(64);
    } finally {
      await controller.close();
      await cache.close();
    }
  });

  test("defaults importance to 1.0 when omitted", async () => {
    const { cache, controller } = makeController();
    try {
      const m = await controller.ingest({ content: "anything" });
      expect(m.importance).toBe(1.0);
    } finally {
      await controller.close();
      await cache.close();
    }
  });
});

describe("SemanticController.search", () => {
  test("returns top-k ordered by similarity", async () => {
    const { cache, controller } = makeController();
    try {
      await controller.ingest({ id: "a", content: "react hooks tutorial" });
      await controller.ingest({ id: "b", content: "sourdough bread recipe" });
      await controller.ingest({ id: "c", content: "react component lifecycle" });
      const results = await controller.search("react", 2);
      expect(results.length).toBe(2);
      expect(results[0]!.similarity).toBeGreaterThanOrEqual(results[1]!.similarity);
      const ids = results.map((r) => r.memory.id);
      expect(ids).toContain("a");
      expect(ids).toContain("c");
    } finally {
      await controller.close();
      await cache.close();
    }
  });
});

describe("SemanticController.compact (Semantic LRU policy)", () => {
  test("no-op when below policyMaxBytes", async () => {
    const { cache, controller } = makeController({ policyMaxBytes: 10 * 1024 * 1024 });
    try {
      await controller.ingest({ content: "short" });
      const report = controller.compact();
      expect(report.belowThreshold).toBe(true);
      expect(report.evicted).toBe(0);
    } finally {
      await controller.close();
      await cache.close();
    }
  });

  test("evicts ~10% when over threshold", async () => {
    const { cache, controller } = makeController({
      policyMaxBytes: 2_000,
      evictFraction: 0.1,
      candidatePoolFraction: 1.0,
    });
    try {
      for (let i = 0; i < 50; i++) {
        await controller.ingest({ content: `unique-topic-${i}-${"x".repeat(20)}` });
      }
      const before = cache.count();
      const report = controller.compact();
      expect(report.belowThreshold).toBe(false);
      expect(report.evicted).toBeGreaterThan(0);
      expect(cache.count()).toBe(before - report.evicted);
      const expected = Math.floor(before * 0.1);
      expect(report.evicted).toBeGreaterThanOrEqual(Math.max(1, expected - 1));
    } finally {
      await controller.close();
      await cache.close();
    }
  });

  test("prefers evicting entries in dense semantic clusters", async () => {
    const { cache, controller } = makeController({
      policyMaxBytes: 1_500,
      evictFraction: 0.2,
      candidatePoolFraction: 1.0,
      densityThreshold: 0.1,
    });
    try {
      const uniqueId = (await controller.ingest({
        content: "unique singular topic about aerospace engineering constraints",
        importance: 1,
      })).id;
      for (let i = 0; i < 20; i++) {
        await controller.ingest({ content: "duplicate duplicate duplicate duplicate" });
      }
      controller.compact();
      expect(cache.get(uniqueId)).not.toBeNull();
    } finally {
      await controller.close();
      await cache.close();
    }
  });

  test("higher-importance entries are preferred over low-importance siblings", async () => {
    const { cache, controller } = makeController({
      policyMaxBytes: 1_500,
      evictFraction: 0.3,
      candidatePoolFraction: 1.0,
    });
    try {
      const critical = (await controller.ingest({
        content: "critical note about production database credentials rotation policy",
        importance: 10,
      })).id;
      for (let i = 0; i < 20; i++) {
        await controller.ingest({ content: `throwaway log line ${i}`, importance: 0.1 });
      }
      controller.compact();
      expect(cache.get(critical)).not.toBeNull();
    } finally {
      await controller.close();
      await cache.close();
    }
  });
});

describe("SemanticController.prefetchForTask", () => {
  test("sets the cache goal to the embedded task vector", async () => {
    const { cache, controller, embedder } = makeController();
    try {
      await controller.prefetchForTask("refactor auth module");
      const expected = await embedder.embed("refactor auth module");
      const actual = cache.goal!;
      expect(actual).not.toBeNull();
      expect(Array.from(actual)).toEqual(Array.from(expected));
    } finally {
      await controller.close();
      await cache.close();
    }
  });
});
