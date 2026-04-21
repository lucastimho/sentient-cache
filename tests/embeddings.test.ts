import { describe, test, expect } from "bun:test";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";
import { cosine } from "../src/cache/similarity";

describe("HashEmbedder", () => {
  test("produces vectors of the requested dimensionality (default 384)", async () => {
    const e = new HashEmbedder();
    const v = await e.embed("hello world");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(384);
  });

  test("custom dimensions are respected", async () => {
    const e = new HashEmbedder(128);
    const v = await e.embed("hi");
    expect(v.length).toBe(128);
  });

  test("rejects invalid dimensions", () => {
    expect(() => new HashEmbedder(0)).toThrow();
    expect(() => new HashEmbedder(-1)).toThrow();
    expect(() => new HashEmbedder(1.5)).toThrow();
  });

  test("output is L2-normalized", async () => {
    const e = new HashEmbedder();
    const v = await e.embed("the quick brown fox jumps over the lazy dog");
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  test("is deterministic for identical inputs", async () => {
    const e = new HashEmbedder();
    const a = await e.embed("semantic cache");
    const b = await e.embed("semantic cache");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("different texts produce different embeddings", async () => {
    const e = new HashEmbedder();
    const a = await e.embed("machine learning");
    const b = await e.embed("cooking recipes");
    expect(cosine(a, b)).toBeLessThan(0.99);
  });

  test("empty text yields a zero vector", async () => {
    const e = new HashEmbedder(64);
    const v = await e.embed("");
    expect(Array.from(v).every((x) => x === 0)).toBe(true);
  });

  test("embedBatch returns embeddings in order", async () => {
    const e = new HashEmbedder();
    const batch = await e.embedBatch(["a", "b", "a"]);
    expect(batch).toHaveLength(3);
    expect(Array.from(batch[0]!)).toEqual(Array.from(batch[2]!));
    expect(Array.from(batch[0]!)).not.toEqual(Array.from(batch[1]!));
  });
});
