// Client-side embedder. Default: HashEmbedder — deterministic, dep-free, runs on
// the main thread in microseconds. Swap to Transformers.js (ONNX via WebAssembly)
// by replacing the impl with a dynamic import; the interface stays the same and
// raw query text never leaves the device either way.

export interface ClientEmbedder {
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array>;
}

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
  const unigrams = normalized.split(/\s+/).filter(Boolean);
  const grams: string[] = [...unigrams];
  for (let i = 0; i < unigrams.length - 1; i++) {
    grams.push(`${unigrams[i]}_${unigrams[i + 1]}`);
  }
  return grams;
}

export class HashEmbedder implements ClientEmbedder {
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
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

let singleton: ClientEmbedder | null = null;
export function getClientEmbedder(): ClientEmbedder {
  if (!singleton) singleton = new HashEmbedder(384);
  return singleton;
}
