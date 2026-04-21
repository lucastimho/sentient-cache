import { describe, test, expect } from "bun:test";
import { SemanticCache } from "../src/cache/SemanticCache";

function padded(n: number, byte = "x"): string {
  return byte.repeat(n);
}

describe("tier-1 LRU prune (inline)", () => {
  test("shrinks below maxBytes after overflowing writes", async () => {
    const cache = new SemanticCache({ maxBytes: 4 * 1024 });
    try {
      for (let i = 0; i < 50; i++) {
        cache.set({ content: padded(200), embedding: new Float32Array(32) });
      }
      expect(cache.size()).toBeLessThanOrEqual(4 * 1024);
      expect(cache.count()).toBeGreaterThan(0);
    } finally {
      await cache.close();
    }
  });

  test("recently touched entry survives pressure", async () => {
    const cache = new SemanticCache({ maxBytes: 4 * 1024 });
    try {
      const hot = cache.set({ id: "hot", content: padded(200), embedding: new Float32Array(32) });
      for (let i = 0; i < 60; i++) {
        cache.set({ content: padded(200), embedding: new Float32Array(32) });
        cache.get(hot.id);
      }
      expect(cache.get(hot.id)).not.toBeNull();
    } finally {
      await cache.close();
    }
  });

  test("totalBytes never drifts above maxBytes after many upserts", async () => {
    const cache = new SemanticCache({ maxBytes: 8 * 1024 });
    try {
      for (let i = 0; i < 200; i++) {
        cache.set({
          id: `slot-${i % 12}`,
          content: padded(300 + (i % 5) * 50),
          embedding: new Float32Array(32),
        });
      }
      expect(cache.size()).toBeLessThanOrEqual(8 * 1024);
    } finally {
      await cache.close();
    }
  });
});

describe("tier-2 semantic compaction (compact())", () => {
  test("compact is a no-op when cache is below the target ratio", async () => {
    const cache = new SemanticCache({ maxBytes: 1024 * 1024 });
    try {
      cache.set({ id: "a", content: "a", embedding: new Float32Array([1, 0, 0, 0]) });
      cache.set({ id: "b", content: "b", embedding: new Float32Array([0, 1, 0, 0]) });
      cache.compact();
      expect(cache.get("a")).not.toBeNull();
      expect(cache.get("b")).not.toBeNull();
    } finally {
      await cache.close();
    }
  });

  test("compact evicts low-utility entries when over target", async () => {
    const cache = new SemanticCache({ maxBytes: 8_000 });
    try {
      const goal = new Float32Array([1, 0, 0, 0]);
      const aligned = cache.set({ id: "aligned", content: "x".repeat(300), embedding: goal });
      cache.get(aligned.id);
      cache.get(aligned.id);
      cache.get(aligned.id);

      for (let i = 0; i < 25; i++) {
        cache.set({
          id: `noise-${i}`,
          content: "x".repeat(300),
          embedding: new Float32Array([0, 0, 0, 1]),
        });
      }

      cache.setGoal(goal);
      cache.compact();

      expect(cache.get(aligned.id)).not.toBeNull();
      expect(cache.size()).toBeLessThanOrEqual(8_000);
    } finally {
      await cache.close();
    }
  });
});
