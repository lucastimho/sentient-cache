import { describe, test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  NoOpEncryptor,
  XorEmbeddingEncryptor,
} from "../src/security/EmbeddingEncryptor";
import { SemanticCache } from "../src/cache/SemanticCache";
import { HashEmbedder } from "../src/embeddings/HashEmbedder";
import { cosine } from "../src/cache/similarity";

function newKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

describe("XorEmbeddingEncryptor", () => {
  test("encrypt → decrypt round-trips bit-exact", () => {
    const enc = new XorEmbeddingEncryptor({ key: newKey() });
    const v = new Float32Array([0.1, -0.2, 3.14, -1e-6, 0]);
    const c = enc.encrypt(v);
    const back = enc.decrypt(c);
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  test("rejects short keys", () => {
    expect(() => new XorEmbeddingEncryptor({ key: new Uint8Array(8) })).toThrow();
  });

  test("ciphertext differs from plaintext bytes", () => {
    const enc = new XorEmbeddingEncryptor({ key: newKey() });
    const v = new Float32Array([1, 2, 3, 4]);
    const plain = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    const cipher = enc.encrypt(v);
    let diffs = 0;
    for (let i = 0; i < plain.length; i++) if (plain[i] !== cipher[i]) diffs++;
    expect(diffs).toBeGreaterThan(0);
  });

  test("deterministic: same key + same input → same ciphertext", () => {
    const key = newKey();
    const a = new XorEmbeddingEncryptor({ key });
    const b = new XorEmbeddingEncryptor({ key });
    const v = new Float32Array([0.25, -0.75]);
    expect(Array.from(a.encrypt(v))).toEqual(Array.from(b.encrypt(v)));
  });

  test("different keys yield different ciphertexts", () => {
    const v = new Float32Array([0.25, -0.75, 1.125]);
    const c1 = new XorEmbeddingEncryptor({ key: newKey() }).encrypt(v);
    const c2 = new XorEmbeddingEncryptor({ key: newKey() }).encrypt(v);
    expect(Array.from(c1)).not.toEqual(Array.from(c2));
  });

  test("NoOpEncryptor is a passthrough for the interface", () => {
    const enc = new NoOpEncryptor();
    const v = new Float32Array([1, 2, 3]);
    expect(Array.from(enc.decrypt(enc.encrypt(v)))).toEqual([1, 2, 3]);
  });
});

describe("SemanticCache with encryptor", () => {
  test("set + get round-trips through encryption transparently", async () => {
    const enc = new XorEmbeddingEncryptor({ key: newKey() });
    const cache = new SemanticCache({ encryptor: enc });
    try {
      const embedder = new HashEmbedder(32);
      const embedding = await embedder.embed("critical plan");
      const m = cache.set({ content: "critical plan", embedding });
      const fetched = cache.get(m.id)!;
      expect(Array.from(fetched.embedding)).toEqual(Array.from(embedding));
    } finally {
      await cache.close();
    }
  });

  test("search over an encrypted cache preserves ordering vs. plaintext", async () => {
    const embedder = new HashEmbedder(32);
    const keyA = newKey();
    const plain = new SemanticCache();
    const encrypted = new SemanticCache({ encryptor: new XorEmbeddingEncryptor({ key: keyA }) });
    try {
      const docs = ["react hooks", "postgres vector", "react suspense", "kubernetes pods"];
      for (const d of docs) {
        const e = await embedder.embed(d);
        plain.set({ id: d, content: d, embedding: e });
        encrypted.set({ id: d, content: d, embedding: e });
      }
      const query = await embedder.embed("react");
      const plainIds = plain.search(query, 4).map((r) => r.memory.id);
      const encIds = encrypted.search(query, 4).map((r) => r.memory.id);
      expect(encIds).toEqual(plainIds);
    } finally {
      await plain.close();
      await encrypted.close();
    }
  });

  test("raw SQLite blob is NOT equal to the plaintext byte representation", async () => {
    const embedder = new HashEmbedder(32);
    const enc = new XorEmbeddingEncryptor({ key: newKey() });
    const cache = new SemanticCache({ encryptor: enc });
    try {
      const embedding = await embedder.embed("secret");
      cache.set({ id: "s", content: "secret", embedding });
      // biome-ignore lint: reach into private db for the test
      const db = (cache as unknown as { db: { prepare: (s: string) => { get: (id: string) => { embedding: Uint8Array } } } }).db;
      const row = db.prepare("SELECT embedding FROM memories WHERE id = ?").get("s");
      const raw = new Uint8Array(row.embedding);
      const plain = new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      expect(raw.byteLength).toBe(plain.byteLength);
      let matches = 0;
      for (let i = 0; i < plain.length; i++) if (raw[i] === plain[i]) matches++;
      expect(matches / plain.length).toBeLessThan(0.5);

      // Cosine on decrypted embedding should still be ~1 against itself
      const readBack = cache.get("s")!.embedding;
      expect(cosine(readBack, embedding)).toBeCloseTo(1, 5);
    } finally {
      await cache.close();
    }
  });
});
