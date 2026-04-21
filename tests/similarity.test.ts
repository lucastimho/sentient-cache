import { describe, test, expect } from "bun:test";
import { cosine, decodeEmbedding, encodeEmbedding } from "../src/cache/similarity";

describe("cosine", () => {
  test("identical vectors give 1", () => {
    expect(cosine(new Float32Array([1, 0, 0]), new Float32Array([1, 0, 0]))).toBeCloseTo(1, 6);
  });

  test("orthogonal vectors give 0", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  test("anti-parallel vectors give -1", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1, 6);
  });

  test("scale invariant", () => {
    expect(cosine(new Float32Array([3, 4]), new Float32Array([6, 8]))).toBeCloseTo(1, 6);
  });

  test("zero vector returns 0 (no NaN)", () => {
    const r = cosine(new Float32Array([0, 0]), new Float32Array([1, 0]));
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe(0);
  });

  test("length mismatch returns 0", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBe(0);
  });

  test("empty vectors return 0", () => {
    expect(cosine(new Float32Array([]), new Float32Array([]))).toBe(0);
  });
});

describe("encode / decode", () => {
  test("roundtrip preserves values", () => {
    const v = new Float32Array([0.1, -0.2, 3.14, -1e-6, 0]);
    const back = decodeEmbedding(encodeEmbedding(v));
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  test("decoded buffer is independent of source", () => {
    const v = new Float32Array([1, 2, 3]);
    const back = decodeEmbedding(encodeEmbedding(v));
    v[0] = 99;
    expect(back[0]).toBe(1);
  });

  test("handles empty embeddings", () => {
    const back = decodeEmbedding(encodeEmbedding(new Float32Array([])));
    expect(back.length).toBe(0);
  });
});
