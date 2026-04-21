import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SemanticCache } from "../src/cache/SemanticCache";
import { randomEmbedding } from "./helpers/stubs";

let cache: SemanticCache;

beforeEach(() => {
  cache = new SemanticCache();
});

afterEach(async () => {
  await cache.close();
});

describe("SemanticCache CRUD", () => {
  test("set then get returns stored memory", () => {
    const embedding = randomEmbedding(16, 1);
    const mem = cache.set({ content: "hello", embedding });
    const fetched = cache.get(mem.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe("hello");
    expect(Array.from(fetched!.embedding)).toEqual(Array.from(embedding));
    expect(fetched!.partition).toBe("working");
  });

  test("get on missing id returns null", () => {
    expect(cache.get("nope")).toBeNull();
  });

  test("get increments access_count", () => {
    const mem = cache.set({ content: "x", embedding: randomEmbedding(8, 2) });
    cache.get(mem.id);
    cache.get(mem.id);
    expect(cache.get(mem.id)!.accessCount).toBeGreaterThanOrEqual(2);
  });

  test("set without id generates a unique id", () => {
    const a = cache.set({ content: "a", embedding: randomEmbedding(4, 1) });
    const b = cache.set({ content: "b", embedding: randomEmbedding(4, 2) });
    expect(a.id).not.toBe(b.id);
    expect(cache.count()).toBe(2);
  });

  test("upsert replaces content + embedding, keeps single row", () => {
    cache.set({ id: "stable", content: "a", embedding: new Float32Array([1, 0, 0]) });
    cache.set({ id: "stable", content: "b", embedding: new Float32Array([0, 1, 0]) });
    const got = cache.get("stable")!;
    expect(got.content).toBe("b");
    expect(Array.from(got.embedding)).toEqual([0, 1, 0]);
    expect(cache.count()).toBe(1);
  });

  test("upsert reconciles size() against prior entry size", () => {
    cache.set({ id: "s", content: "x".repeat(500), embedding: randomEmbedding(32, 3) });
    const after1 = cache.size();
    cache.set({ id: "s", content: "y", embedding: randomEmbedding(32, 3) });
    const after2 = cache.size();
    expect(after2).toBeLessThan(after1);
  });

  test("partition override is respected", () => {
    const m = cache.set({ content: "a", embedding: randomEmbedding(4, 1), partition: "archive" });
    expect(cache.get(m.id)!.partition).toBe("archive");
  });

  test("size() and count() start at 0 for fresh cache", () => {
    expect(cache.size()).toBe(0);
    expect(cache.count()).toBe(0);
  });
});

describe("SemanticCache search", () => {
  test("returns top-k sorted by similarity desc", () => {
    cache.set({ id: "far", content: "", embedding: new Float32Array([0, 0, 1]) });
    cache.set({ id: "mid", content: "", embedding: new Float32Array([0.7, 0.7, 0]) });
    cache.set({ id: "near", content: "", embedding: new Float32Array([1, 0, 0]) });

    const results = cache.search(new Float32Array([1, 0, 0]), 3);
    expect(results.map((r) => r.memory.id)).toEqual(["near", "mid", "far"]);
    expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
    expect(results[1]!.similarity).toBeGreaterThan(results[2]!.similarity);
  });

  test("k greater than count returns all", () => {
    cache.set({ content: "x", embedding: new Float32Array([1, 0]) });
    expect(cache.search(new Float32Array([1, 0]), 10)).toHaveLength(1);
  });

  test("empty cache returns []", () => {
    expect(cache.search(new Float32Array([1, 0]), 5)).toEqual([]);
  });

  test("search does not bump access_count", () => {
    const m = cache.set({ content: "x", embedding: new Float32Array([1, 0]) });
    cache.search(new Float32Array([1, 0]), 1);
    expect(cache.get(m.id)!.accessCount).toBe(1);
  });
});

describe("SemanticCache persistence", () => {
  test("rows and totalBytes survive reopen", async () => {
    const path = join(tmpdir(), `sc-persist-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      const c1 = new SemanticCache({ path });
      c1.set({ id: "p", content: "abc", embedding: new Float32Array([1, 2, 3]) });
      const size1 = c1.size();
      await c1.close();

      const c2 = new SemanticCache({ path });
      expect(c2.get("p")).not.toBeNull();
      expect(c2.size()).toBe(size1);
      await c2.close();
    } finally {
      for (const suffix of ["", "-shm", "-wal"]) {
        try {
          rmSync(path + suffix);
        } catch {
          /* best effort */
        }
      }
    }
  });
});
