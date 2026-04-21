import type { HudMemory } from "./types";
import { HashEmbedder } from "./embedder";

const TOPIC_SEEDS = [
  "machine learning training loops and gradient descent optimization",
  "react server components streaming hydration boundary",
  "postgres pgvector cosine distance HNSW index tuning",
  "kubernetes horizontal pod autoscaler memory pressure",
  "rust ownership borrow checker lifetime elision",
  "designing for accessibility color contrast semantic html",
  "distributed consensus raft leader election heartbeat",
  "typescript generics variance conditional inference",
  "edge caching CDN purging revalidation strategies",
  "sqlite write-ahead log checkpoint wal2 journal mode",
  "bun runtime ffi sqlite native driver performance",
  "cpu cache line false sharing atomic memory ordering",
  "llm prompt caching cache key attention heads",
  "pgvector index rebuild concurrent vacuum analyze",
  "graphql persisted queries cdn edge executor",
  "semantic search vector quantization dimensionality reduction",
  "llvm ir codegen optimization passes",
  "golang goroutine scheduling work stealing",
  "observability structured logging span propagation",
  "CRDT last writer wins vector clock conflict resolution",
];

export async function generateMockMemories(n: number): Promise<HudMemory[]> {
  const embedder = new HashEmbedder(384);
  const now = Date.now();
  const out: HudMemory[] = [];
  for (let i = 0; i < n; i++) {
    const seed = TOPIC_SEEDS[i % TOPIC_SEEDS.length]!;
    const variant = `${seed} ${i}-${Math.floor(Math.random() * 1000)}`;
    const content = `#${i + 1} ${variant}`;
    const partition: HudMemory["partition"] = i % 7 === 0 ? "archive" : "working";
    const age = Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000);
    const accessCount = Math.floor(Math.random() * 40);
    const importance = Math.round((Math.random() * 0.9 + 0.1) * 10) / 10;
    const embedding = await embedder.embed(variant);
    out.push({
      id: `mem-${i.toString(16).padStart(4, "0")}`,
      content,
      embedding,
      importance,
      accessCount,
      lastAccessedAt: now - age,
      createdAt: now - age - Math.floor(Math.random() * 60_000),
      sizeBytes: content.length * 4 + 1536,
      partition,
      syncState: i % 11 === 0 ? "syncing" : "synced",
    });
  }
  return out;
}
