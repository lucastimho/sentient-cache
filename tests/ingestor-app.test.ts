import { describe, test, expect } from "bun:test";
import { SemanticCache } from "../src/cache/SemanticCache";
import { SemanticController } from "../src/controller/SemanticController";
import { SessionRegistry } from "../src/controller/SessionRegistry";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";
import { createIngestorApp } from "../src/ingestor/app";

function bootstrap() {
  const cache = new SemanticCache();
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
  return { app, cache, controller, registry, teardown };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Ingestor HTTP API", () => {
  test("GET /healthz returns embedding dims", async () => {
    const { app, teardown } = bootstrap();
    try {
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; embeddingDims: number };
      expect(body.ok).toBe(true);
      expect(body.embeddingDims).toBe(64);
    } finally {
      await teardown();
    }
  });

  test("POST /ingest stores a memory and reports size/importance", async () => {
    const { app, cache, teardown } = bootstrap();
    try {
      const res = await app.request(jsonRequest("/ingest", { content: "hello", importance: 3 }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; size_bytes: number; importance: number };
      expect(body.importance).toBe(3);
      expect(cache.get(body.id)).not.toBeNull();
    } finally {
      await teardown();
    }
  });

  test("POST /ingest validates that content is present", async () => {
    const { app, teardown } = bootstrap();
    try {
      const res = await app.request(jsonRequest("/ingest", { importance: 1 }));
      expect(res.status).toBe(400);
    } finally {
      await teardown();
    }
  });

  test("POST /search returns top-k ranked results", async () => {
    const { app, teardown } = bootstrap();
    try {
      await app.request(jsonRequest("/ingest", { content: "vector databases" }));
      await app.request(jsonRequest("/ingest", { content: "kitchen cleaning tips" }));
      await app.request(jsonRequest("/ingest", { content: "vector index performance" }));
      const res = await app.request(jsonRequest("/search", { query: "vector", k: 2 }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: Array<{ content: string; similarity: number }> };
      expect(body.results).toHaveLength(2);
      expect(body.results[0]!.similarity).toBeGreaterThanOrEqual(body.results[1]!.similarity);
    } finally {
      await teardown();
    }
  });

  test("POST /sessions/:id/task reports change and triggers prefetch", async () => {
    const { app, cache, teardown } = bootstrap();
    try {
      const first = await app.request(
        jsonRequest("/sessions/session-42/task", { current_task: "draft-email" }),
      );
      const firstBody = (await first.json()) as { changed: boolean; previous_task?: string };
      expect(firstBody.changed).toBe(true);
      expect(firstBody.previous_task).toBeUndefined();

      await new Promise((r) => setTimeout(r, 20));
      expect(cache.goal).not.toBeNull();

      const second = await app.request(
        jsonRequest("/sessions/session-42/task", { current_task: "draft-email" }),
      );
      const secondBody = (await second.json()) as { changed: boolean };
      expect(secondBody.changed).toBe(false);
    } finally {
      await teardown();
    }
  });

  test("refresh-ahead middleware fires when /ingest carries session_id + current_task", async () => {
    const { app, controller, teardown } = bootstrap();
    try {
      const res = await app.request(
        jsonRequest("/ingest", {
          content: "plan it",
          session_id: "s1",
          current_task: "trip-planning",
        }),
      );
      const body = (await res.json()) as { prefetch_triggered: boolean };
      expect(body.prefetch_triggered).toBe(true);

      const resUnchanged = await app.request(
        jsonRequest("/ingest", {
          content: "again",
          session_id: "s1",
          current_task: "trip-planning",
        }),
      );
      const bodyUnchanged = (await resUnchanged.json()) as { prefetch_triggered: boolean };
      expect(bodyUnchanged.prefetch_triggered).toBe(false);

      void controller;
    } finally {
      await teardown();
    }
  });

  test("refresh-ahead middleware does not block the response", async () => {
    const cache = new SemanticCache();
    const embedder = new HashEmbedder(64);
    const slowEmbedder = {
      dimensions: embedder.dimensions,
      embed: async (t: string) => {
        await new Promise((r) => setTimeout(r, 150));
        return embedder.embed(t);
      },
    };
    const controller = new SemanticController({
      cache,
      embedder: slowEmbedder,
      policyIntervalMs: 1_000_000,
    });
    const registry = new SessionRegistry();
    const app = createIngestorApp({ controller, registry });
    try {
      await app.request(jsonRequest("/ingest", { content: "warm" }));
      const start = performance.now();
      const res = await app.request(
        jsonRequest("/sessions/s1/task", { current_task: "urgent-thing" }),
      );
      const elapsed = performance.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(140);
    } finally {
      await controller.close();
      await cache.close();
    }
  });
});
