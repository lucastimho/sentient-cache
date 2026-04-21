export type Partition = "working" | "archive";

export interface Memory {
  id: string;
  content: string;
  embedding: Float32Array;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  sizeBytes: number;
  partition: Partition;
  importance: number;
}

export interface MemoryInput {
  id?: string;
  content: string;
  embedding: Float32Array;
  partition?: Partition;
  importance?: number;
}

export interface ScoredMemory {
  memory: Memory;
  similarity: number;
}

export interface UtilityScored {
  id: string;
  utility: number;
  sizeBytes: number;
}

export interface RemoteStore {
  fetchTopK(embedding: Float32Array, k: number): Promise<Memory[]>;
  writeBatch(memories: Memory[]): Promise<void>;
}

export interface WriteBehindQueue {
  enqueueBatch(ids: string[]): Promise<void>;
  close(): Promise<void>;
}
