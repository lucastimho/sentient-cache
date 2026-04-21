import { cosine } from "../cache/similarity";
import type { SemanticCache } from "../cache/SemanticCache";
import type { Embedder } from "../embeddings/Embedder";
import type { Memory, RemoteStore, ScoredMemory } from "../types";

const DEFAULTS = {
  policyMaxBytes: 100 * 1024 * 1024,
  evictFraction: 0.1,
  candidatePoolFraction: 0.25,
  minCandidatePool: 32,
  densityThreshold: 0.85,
  recencyHalfLifeMs: 24 * 60 * 60 * 1000,
  policyIntervalMs: 60_000,
  prefetchK: 10,
};

export interface SemanticControllerOptions {
  cache: SemanticCache;
  embedder: Embedder;
  remote?: RemoteStore;
  policyMaxBytes?: number;
  evictFraction?: number;
  candidatePoolFraction?: number;
  densityThreshold?: number;
  recencyHalfLifeMs?: number;
  policyIntervalMs?: number;
  prefetchK?: number;
  onPolicyError?: (err: unknown) => void;
}

export interface IngestInput {
  id?: string;
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface CompactionReport {
  skipped: boolean;
  inspected: number;
  evicted: number;
  bytesFreed: number;
  belowThreshold: boolean;
}

interface ResolvedOpts extends Required<Omit<SemanticControllerOptions, "remote" | "onPolicyError">> {
  remote?: RemoteStore;
  onPolicyError: (err: unknown) => void;
}

export class SemanticController {
  private readonly opts: ResolvedOpts;
  private policyTimer?: ReturnType<typeof setInterval>;
  private closed = false;
  private compacting = false;

  constructor(options: SemanticControllerOptions) {
    this.opts = {
      cache: options.cache,
      embedder: options.embedder,
      remote: options.remote,
      policyMaxBytes: options.policyMaxBytes ?? DEFAULTS.policyMaxBytes,
      evictFraction: options.evictFraction ?? DEFAULTS.evictFraction,
      candidatePoolFraction: options.candidatePoolFraction ?? DEFAULTS.candidatePoolFraction,
      densityThreshold: options.densityThreshold ?? DEFAULTS.densityThreshold,
      recencyHalfLifeMs: options.recencyHalfLifeMs ?? DEFAULTS.recencyHalfLifeMs,
      policyIntervalMs: options.policyIntervalMs ?? DEFAULTS.policyIntervalMs,
      prefetchK: options.prefetchK ?? DEFAULTS.prefetchK,
      onPolicyError:
        options.onPolicyError ?? ((err) => console.error("[sentient-controller] policy error", err)),
    };
    this.startPolicyLoop();
  }

  get embeddingDimensions(): number {
    return this.opts.embedder.dimensions;
  }

  async ingest(input: IngestInput): Promise<Memory> {
    const embedding = await this.opts.embedder.embed(input.content);
    return this.opts.cache.set({
      id: input.id,
      content: input.content,
      embedding,
      importance: input.importance,
    });
  }

  async search(query: string, k = 5): Promise<ScoredMemory[]> {
    const embedding = await this.opts.embedder.embed(query);
    return this.opts.cache.search(embedding, k);
  }

  searchByEmbedding(embedding: Float32Array, k = 5): ScoredMemory[] {
    return this.opts.cache.search(embedding, k);
  }

  async prefetchForTask(task: string): Promise<void> {
    const embedding = await this.opts.embedder.embed(task);
    this.opts.cache.setGoal(embedding);
  }

  compact(): CompactionReport {
    if (this.compacting) {
      return { skipped: true, inspected: 0, evicted: 0, bytesFreed: 0, belowThreshold: false };
    }
    this.compacting = true;
    try {
      const totalBytes = this.opts.cache.size();
      if (totalBytes < this.opts.policyMaxBytes) {
        return { skipped: false, inspected: 0, evicted: 0, bytesFreed: 0, belowThreshold: true };
      }

      const totalCount = this.opts.cache.count();
      const targetEvict = Math.max(1, Math.floor(totalCount * this.opts.evictFraction));
      const poolSize = Math.max(
        DEFAULTS.minCandidatePool,
        Math.floor(totalCount * this.opts.candidatePoolFraction),
        targetEvict * 2,
      );

      const candidates = this.opts.cache.list(poolSize);
      if (candidates.length === 0) {
        return { skipped: false, inspected: 0, evicted: 0, bytesFreed: 0, belowThreshold: false };
      }

      const scored = this.scoreCandidates(candidates);
      scored.sort((a, b) => a.utility - b.utility);

      const evictionSlots = Math.min(targetEvict, scored.length);
      let evicted = 0;
      let bytesFreed = 0;
      for (let i = 0; i < evictionSlots; i++) {
        const entry = scored[i]!;
        if (this.opts.cache.delete(entry.id)) {
          evicted++;
          bytesFreed += entry.sizeBytes;
        }
      }

      return {
        skipped: false,
        inspected: candidates.length,
        evicted,
        bytesFreed,
        belowThreshold: false,
      };
    } finally {
      this.compacting = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.policyTimer) clearInterval(this.policyTimer);
  }

  private startPolicyLoop(): void {
    this.policyTimer = setInterval(() => {
      if (this.closed) return;
      try {
        this.compact();
      } catch (err) {
        this.opts.onPolicyError(err);
      }
    }, this.opts.policyIntervalMs);
    this.policyTimer.unref?.();
  }

  private scoreCandidates(
    candidates: Memory[],
  ): { id: string; sizeBytes: number; utility: number; density: number }[] {
    const now = Date.now();
    const densities = new Array<number>(candidates.length).fill(0);

    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        if (cosine(a.embedding, b.embedding) > this.opts.densityThreshold) {
          densities[i] = (densities[i] ?? 0) + 1;
          densities[j] = (densities[j] ?? 0) + 1;
        }
      }
    }

    return candidates.map((m, i) => {
      const age = Math.max(0, now - m.lastAccessedAt);
      const recency = Math.exp(-age / this.opts.recencyHalfLifeMs);
      const importance = Math.max(0.01, m.importance);
      const density = densities[i] ?? 0;
      const utility = (recency * importance) / (1 + density);
      return { id: m.id, sizeBytes: m.sizeBytes, utility, density };
    });
  }
}
