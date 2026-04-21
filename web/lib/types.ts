export interface HudMemory {
  id: string;
  content: string;
  embedding: Float32Array;
  importance: number;
  accessCount: number;
  lastAccessedAt: number;
  createdAt: number;
  sizeBytes: number;
  partition: "working" | "archive";
  syncState: "local" | "syncing" | "synced";
}

export interface LatencySample {
  at: number;
  edgeMs: number;
  source: "local-cache" | "remote" | "refresh-ahead";
}

export const LATENCY_REFERENCES = [
  { label: "L1 cache", ns: 1 },
  { label: "Main memory", ns: 100 },
  { label: "SSD read", ns: 150_000 },
  { label: "Network (same-region)", ns: 500_000 },
] as const;

export interface SyncJob {
  id: string;
  memoryId: string;
  enqueuedAt: number;
  attempts: number;
  state: "pending" | "flushing" | "done" | "error";
}
