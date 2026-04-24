import { createHash } from "node:crypto";

// Contract for an at-rest privacy layer over stored embedding blobs. The
// current XOR impl is encryption-at-rest only — it protects against raw SQLite
// file / pg_vector dump exfiltration, but cosine similarity still has to be
// computed on decrypted floats. A true SSE scheme (lattice-based ORE, secure
// inner-product, etc.) would implement a keyed homomorphism Φ on the vectors
// so similarity could be computed directly on ciphertext; it would plug in
// behind this same interface.
export interface EmbeddingEncryptor {
  readonly scheme: string;
  encrypt(embedding: Float32Array): Uint8Array;
  decrypt(ciphertext: Uint8Array): Float32Array;
}

function deriveKeystream(key: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let written = 0;
  let counter = 0;
  while (written < length) {
    const h = createHash("sha256");
    h.update(key);
    const ctr = new Uint8Array(4);
    new DataView(ctr.buffer).setUint32(0, counter++, false);
    h.update(ctr);
    const digest = h.digest();
    const n = Math.min(digest.length, length - written);
    out.set(digest.subarray(0, n), written);
    written += n;
  }
  return out;
}

export interface XorEmbeddingEncryptorOptions {
  key: Uint8Array;
  keystreamBytes?: number;
}

export class XorEmbeddingEncryptor implements EmbeddingEncryptor {
  readonly scheme = "xor-sha256-ctr";
  private readonly keystream: Uint8Array;

  constructor(opts: XorEmbeddingEncryptorOptions) {
    if (opts.key.byteLength < 16) {
      throw new Error("key must be at least 128 bits");
    }
    const size = opts.keystreamBytes ?? 4096;
    this.keystream = deriveKeystream(opts.key, size);
  }

  encrypt(embedding: Float32Array): Uint8Array {
    return this.xor(
      new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength),
    );
  }

  decrypt(ciphertext: Uint8Array): Float32Array {
    const plain = this.xor(ciphertext);
    const copy = new ArrayBuffer(plain.byteLength);
    new Uint8Array(copy).set(plain);
    return new Float32Array(copy);
  }

  private xor(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.byteLength);
    const ks = this.keystream;
    const period = ks.length;
    for (let i = 0; i < bytes.length; i++) {
      out[i] = (bytes[i] ?? 0) ^ (ks[i % period] ?? 0);
    }
    return out;
  }
}

export class NoOpEncryptor implements EmbeddingEncryptor {
  readonly scheme = "none";
  encrypt(embedding: Float32Array): Uint8Array {
    return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  }
  decrypt(ciphertext: Uint8Array): Float32Array {
    const copy = new ArrayBuffer(ciphertext.byteLength);
    new Uint8Array(copy).set(ciphertext);
    return new Float32Array(copy);
  }
}
