import { describe, test, expect } from "bun:test";
import { rankForEviction, utilityScore } from "../src/cache/eviction";
import { fabricateMemory } from "./helpers/stubs";

const now = 10_000;

describe("utilityScore", () => {
  test("similar-to-goal outranks orthogonal (same access/time)", () => {
    const goal = new Float32Array([1, 0]);
    const aligned = fabricateMemory({
      embedding: new Float32Array([1, 0]),
      accessCount: 1,
      lastAccessedAt: now - 1000,
    });
    const orthogonal = fabricateMemory({
      embedding: new Float32Array([0, 1]),
      accessCount: 1,
      lastAccessedAt: now - 1000,
    });
    expect(utilityScore(aligned, goal, now)).toBeGreaterThan(utilityScore(orthogonal, goal, now));
  });

  test("higher access count yields higher utility", () => {
    const cold = fabricateMemory({ accessCount: 0, lastAccessedAt: now - 1000 });
    const hot = fabricateMemory({ accessCount: 100, lastAccessedAt: now - 1000 });
    expect(utilityScore(hot, null, now)).toBeGreaterThan(utilityScore(cold, null, now));
  });

  test("older last access yields lower utility", () => {
    const recent = fabricateMemory({ accessCount: 1, lastAccessedAt: now - 1000 });
    const ancient = fabricateMemory({ accessCount: 1, lastAccessedAt: now - 1_000_000 });
    expect(utilityScore(recent, null, now)).toBeGreaterThan(utilityScore(ancient, null, now));
  });

  test("just-accessed memory never returns Infinity", () => {
    const fresh = fabricateMemory({ accessCount: 5, lastAccessedAt: now });
    const score = utilityScore(fresh, null, now);
    expect(Number.isFinite(score)).toBe(true);
  });

  test("zero access count never returns 0 (count floor)", () => {
    const zero = fabricateMemory({ accessCount: 0, lastAccessedAt: now - 1000 });
    expect(utilityScore(zero, null, now)).toBeGreaterThan(0);
  });
});

describe("rankForEviction", () => {
  test("sorts ascending: lowest utility first", () => {
    const rows = [
      fabricateMemory({ id: "hot", accessCount: 100, lastAccessedAt: now - 1000 }),
      fabricateMemory({ id: "cold", accessCount: 0, lastAccessedAt: now - 1_000_000 }),
      fabricateMemory({ id: "warm", accessCount: 5, lastAccessedAt: now - 10_000 }),
    ];
    const ranked = rankForEviction(rows, null, now);
    expect(ranked.map((r) => r.id)).toEqual(["cold", "warm", "hot"]);
  });

  test("preserves size_bytes from source rows", () => {
    const row = fabricateMemory({ id: "x", sizeBytes: 777 });
    const ranked = rankForEviction([row], null, now);
    expect(ranked[0]!.sizeBytes).toBe(777);
  });

  test("returns empty array for empty input", () => {
    expect(rankForEviction([], null, now)).toEqual([]);
  });
});
