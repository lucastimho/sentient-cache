export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function encodeEmbedding(e: Float32Array): Uint8Array {
  return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
}

export function decodeEmbedding(b: Uint8Array | ArrayBufferLike): Float32Array {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b as ArrayBuffer);
  const copy = new ArrayBuffer(u8.byteLength);
  new Uint8Array(copy).set(u8);
  return new Float32Array(copy);
}
