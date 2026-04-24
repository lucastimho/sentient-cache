import { describe, test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { SemanticCache } from "../src/cache/SemanticCache";
import { SemanticController } from "../src/controller/SemanticController";
import { SessionRegistry } from "../src/controller/SessionRegistry";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";
import { createIngestorApp } from "../src/ingestor/app";
import {
  CapabilityTableEvaluator,
  type CapabilityTable,
} from "../src/security/OpaEvaluator";
import { ResourceSentinel } from "../src/security/ResourceSentinel";
import { XorEmbeddingEncryptor } from "../src/security/EmbeddingEncryptor";

const TABLE: CapabilityTable = {
  "agent-ok": { "journal": ["read", "write", "search"], "*": ["search"] },
  "agent-readonly": { "journal": ["read", "search"] },
};

function boot(opts: { queueLimitBytes?: number } = {}) {
  const cache = new SemanticCache({
    encryptor: new XorEmbeddingEncryptor({ key: new Uint8Array(randomBytes(32)) }),
  });
  const embedder = new HashEmbedder(64);
  const controller = new SemanticController({
    cache,
    embedder,
    policyIntervalMs: 1_000_000,
  });
  const registry = new SessionRegistry();
  const sentinel = new ResourceSentinel({ queueLimitBytes: opts.queueLimitBytes ?? 1024 });
  const evaluator = new CapabilityTableEvaluator({ table: TABLE });
  const app = createIngestorApp({ controller, registry, sentinel, opaEvaluator: evaluator });
  return {
    app,
    cache,
    sentinel,
    teardown: async () => {
      await controller.close();
      await cache.close();
    },
  };
}

const jsonPost = (path: string, body: unknown, headers: Record<string, string>): Request =>
  new Request(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("Full security stack integrated with the ingestor", () => {
  test("sentinel + OPA + encrypted cache: authorized write survives the pipeline", async () => {
    const { app, cache, teardown } = boot();
    try {
      const res = await app.request(
        jsonPost(
          "/ingest",
          { content: "meeting prep", memory_tag: "journal" },
          { "x-agent-id": "agent-ok" },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      const stored = cache.get(body.id);
      expect(stored).not.toBeNull();
      expect(stored!.content).toBe("meeting prep");
    } finally {
      await teardown();
    }
  });

  test("OPA blocks a write for an agent that only has read/search", async () => {
    const { app, teardown } = boot();
    try {
      const res = await app.request(
        jsonPost(
          "/ingest",
          { content: "blocked", memory_tag: "journal" },
          { "x-agent-id": "agent-readonly" },
        ),
      );
      expect(res.status).toBe(403);
    } finally {
      await teardown();
    }
  });

  test("missing agent header short-circuits with 401 before touching the cache", async () => {
    const { app, cache, teardown } = boot();
    try {
      const res = await app.request(
        jsonPost("/ingest", { content: "phantom", memory_tag: "journal" }, {}),
      );
      expect(res.status).toBe(401);
      expect(cache.count()).toBe(0);
    } finally {
      await teardown();
    }
  });

  test("sentinel rejects with 503 when an oversized body would blow the queue limit", async () => {
    const { app, teardown } = boot({ queueLimitBytes: 256 });
    try {
      const res = await app.request(
        new Request("http://test/ingest", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-agent-id": "agent-ok",
            "content-length": "4096",
          },
          body: JSON.stringify({ content: "x".repeat(4096), memory_tag: "journal" }),
        }),
      );
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).not.toBeNull();
    } finally {
      await teardown();
    }
  });

  test("an allowed search operation passes through to the controller", async () => {
    const { app, teardown } = boot();
    try {
      await app.request(
        jsonPost(
          "/ingest",
          { content: "react hooks", memory_tag: "journal" },
          { "x-agent-id": "agent-ok" },
        ),
      );
      const res = await app.request(
        jsonPost(
          "/search",
          { query: "react", k: 3, memory_tag: "journal" },
          { "x-agent-id": "agent-readonly" },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: Array<{ content: string }> };
      expect(body.results.length).toBeGreaterThan(0);
    } finally {
      await teardown();
    }
  });
});
