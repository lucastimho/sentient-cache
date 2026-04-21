import type { Embedder } from "./Embedder";

function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
  const tokens: string[] = [];
  for (const t of normalized.split(/\s+/)) if (t) tokens.push(t);
  for (let i = 0; i < tokens.length - 1; i++) {
    tokens.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return tokens;
}

export class HashEmbedder implements Embedder {
  readonly dimensions: number;

  constructor(dimensions = 384) {
    if (dimensions <= 0 || !Number.isInteger(dimensions)) {
      throw new Error("dimensions must be a positive integer");
    }
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(this.dimensions);
    const tokens = tokenize(text);
    if (tokens.length === 0) return vec;

    for (const tok of tokens) {
      const h1 = fnv1a(tok);
      const h2 = fnv1a(tok, 0x50a7f32f);
      const idx = h1 % this.dimensions;
      const sign = (h2 & 1) === 0 ? 1 : -1;
      vec[idx] = (vec[idx] ?? 0) + sign;
    }

    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      const v = vec[i] ?? 0;
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm;
    }
    return vec;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }
}
