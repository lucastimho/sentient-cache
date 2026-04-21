import { describe, test, expect } from "bun:test";
import { SemanticCache } from "../src/cache/SemanticCache";
import { SemanticController } from "../src/controller/SemanticController";
import { SessionRegistry } from "../src/controller/SessionRegistry";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";
import { TransformersEmbedder } from "../src/embeddings/TransformersEmbedder";
import { createIngestorApp } from "../src/ingestor/app";

function bootstrap(cacheMaxBytes = 5 * 1024 * 1024) {
  const cache = new SemanticCache({ maxBytes: cacheMaxBytes });
  const embedder = new HashEmbedder(64);
  const controller = new SemanticController({
    cache,
    embedder,
    policyIntervalMs: 1_000_000,
  });
  const registry = new SessionRegistry();
  const app = createIngestorApp({ controller, registry });
  const teardown = async () => {
    await controller.close();
    await cache.close();
  };
  return { cache, controller, registry, app, teardown };
}

function rawPost(path: string, body: string, contentType = "application/json"): Request {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

describe("Adversarial HTTP inputs", () => {
  test("POST /ingest with empty body returns 400", async () => {
    const { app, teardown } = bootstrap();
    try {
      const res = await app.request(rawPost("/ingest", ""));
      expect(res.status).toBe(400);
    } finally {
      await teardown();
    }
  });

  test("POST /ingest with malformed JSON returns 400", async () => {
    const { app, teardown } = bootstrap();
    try {
      const res = await app.request(rawPost("/ingest", "{not-valid-json"));
      expect(res.status).toBe(400);
    } finally {
      await teardown();
    }
  });

  test("POST /search without a query returns 400", async () => {
    const { app, teardown } = bootstrap();
    try {
      const res = await app.request(rawPost("/search", JSON.stringify({})));
      expect(res.status).toBe(400);
    } finally {
      await teardown();
    }
  });

  test("POST /search with an absurd k is clamped at 100", async () => {
    const { app, teardown } = bootstrap();
    try {
      await app.request(rawPost("/ingest", JSON.stringify({ content: "x" })));
      const res = await app.request(rawPost("/search", JSON.stringify({ query: "x", k: 100_000 })));
      expect(res.status).toBe(200);
      const { results } = (await res.json()) as { results: unknown[] };
      expect(results.length).toBeLessThanOrEqual(100);
    } finally {
      await teardown();
    }
  });

  test("POST /sessions/:id/task without current_task returns 400", async () => {
    const { app, teardown } = bootstrap();
    try {
      const res = await app.request(rawPost("/sessions/s1/task", JSON.stringify({})));
      expect(res.status).toBe(400);
    } finally {
      await teardown();
    }
  });

  test("unknown routes return 404", async () => {
    const { app, teardown } = bootstrap();
    try {
      const res = await app.request("http://test/does-not-exist");
      expect(res.status).toBe(404);
    } finally {
      await teardown();
    }
  });
});

describe("Content edge cases", () => {
  test("unicode / emoji / CJK content is stored and retrieved intact", async () => {
    const { cache, controller, teardown } = bootstrap();
    try {
      const content = "日本語 こんにちは 🚀 ñ ö é 🧠";
      const m = await controller.ingest({ content });
      expect(cache.get(m.id)!.content).toBe(content);
    } finally {
      await teardown();
    }
  });

  test("SQL-like payload is stored as plain text (parameterized inserts isolate it)", async () => {
    const { cache, controller, teardown } = bootstrap();
    try {
      const content = "'); DROP TABLE memories; --";
      const m = await controller.ingest({ content });
      expect(cache.get(m.id)!.content).toBe(content);
      expect(cache.count()).toBe(1);
    } finally {
      await teardown();
    }
  });

  test("very large content (~500KB) is accepted and size-accounted correctly", async () => {
    const { cache, controller, teardown } = bootstrap(8 * 1024 * 1024);
    try {
      const content = "x".repeat(500_000);
      const m = await controller.ingest({ content });
      expect(cache.get(m.id)!.content.length).toBe(500_000);
      expect(m.sizeBytes).toBeGreaterThan(500_000);
    } finally {
      await teardown();
    }
  });

  test("extreme importance values are persisted verbatim (policy applies floors, not storage)", async () => {
    const { cache, teardown } = bootstrap();
    try {
      const embedder = new HashEmbedder(64);
      const embedding = await embedder.embed("payload");
      const neg = cache.set({ content: "neg", embedding, importance: -5 });
      const huge = cache.set({ content: "huge", embedding, importance: 1_000_000 });
      expect(cache.get(neg.id)!.importance).toBe(-5);
      expect(cache.get(huge.id)!.importance).toBe(1_000_000);
    } finally {
      await teardown();
    }
  });
});

describe("Load / concurrency", () => {
  test("1,000 ingests with tight policy keep cache bounded", async () => {
    const cache = new SemanticCache({ maxBytes: 500 * 1024 });
    const embedder = new HashEmbedder(64);
    const controller = new SemanticController({
      cache,
      embedder,
      policyMaxBytes: 256 * 1024,
      policyIntervalMs: 1_000_000,
      evictFraction: 0.1,
      candidatePoolFraction: 0.5,
    });
    try {
      for (let i = 0; i < 1000; i++) {
        await controller.ingest({ content: `doc-${i}-${"x".repeat(400)}` });
      }
      controller.compact();
      expect(cache.size()).toBeLessThanOrEqual(500 * 1024);
      expect(cache.count()).toBeGreaterThan(0);
    } finally {
      await controller.close();
      await cache.close();
    }
  });

  test("concurrent ingests + searches settle to a consistent row count", async () => {
    const { cache, controller, teardown } = bootstrap();
    try {
      const ingests = Array.from({ length: 50 }, (_, i) =>
        controller.ingest({ content: `doc-${i}` }),
      );
      const searches = Array.from({ length: 20 }, () => controller.search("doc", 5));
      await Promise.all([...ingests, ...searches]);
      expect(cache.count()).toBe(50);
    } finally {
      await teardown();
    }
  });

  test("rapid goal/task changes do not corrupt session state", async () => {
    const registry = new SessionRegistry();
    for (let i = 0; i < 200; i++) {
      registry.setTask("s1", `task-${i % 5}`);
    }
    expect(registry.size()).toBe(1);
    expect(registry.getTask("s1")).toBe("task-4");
  });
});

describe("Lifecycle", () => {
  test("SemanticCache.close() is idempotent", async () => {
    const cache = new SemanticCache();
    await cache.close();
    await expect(cache.close()).resolves.toBeUndefined();
  });

  test("SemanticController.close() is idempotent", async () => {
    const cache = new SemanticCache();
    const controller = new SemanticController({
      cache,
      embedder: new HashEmbedder(64),
      policyIntervalMs: 1_000_000,
    });
    await controller.close();
    await expect(controller.close()).resolves.toBeUndefined();
    await cache.close();
  });

  test("policy timer does not prevent process exit (unref'd)", async () => {
    const cache = new SemanticCache();
    const controller = new SemanticController({
      cache,
      embedder: new HashEmbedder(64),
      policyIntervalMs: 10,
    });
    await new Promise((r) => setTimeout(r, 30));
    await controller.close();
    await cache.close();
  });
});

describe("Embedder failure modes", () => {
  test("TransformersEmbedder surfaces a helpful error when the optional dep is missing", async () => {
    const e = new TransformersEmbedder();
    await expect(e.embed("anything")).rejects.toThrow(/@xenova\/transformers/);
  });
});
