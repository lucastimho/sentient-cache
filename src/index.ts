export { SemanticCache, type SemanticCacheOptions } from "./cache/SemanticCache";
export { cosine } from "./cache/similarity";
export { utilityScore, rankForEviction } from "./cache/eviction";
export { BullWriteBehindQueue, SYNC_QUEUE_NAME, SYNC_JOB_NAME } from "./sync/WriteBehindQueue";
export { SyncWorker } from "./sync/SyncWorker";
export { PostgresRemoteStore } from "./sync/RemoteStore";
export { HashEmbedder } from "./embeddings/HashEmbedder";
export { TransformersEmbedder } from "./embeddings/TransformersEmbedder";
export type { Embedder } from "./embeddings/Embedder";
export {
  SemanticController,
  type SemanticControllerOptions,
  type IngestInput,
  type CompactionReport,
} from "./controller/SemanticController";
export { SessionRegistry, type TaskChange } from "./controller/SessionRegistry";
export { createIngestorApp } from "./ingestor/app";
export {
  refreshAheadMiddleware,
  getRefreshAheadHook,
  getCachedBody,
  type RefreshAheadHook,
} from "./ingestor/refreshAhead";
export type {
  Memory,
  MemoryInput,
  Partition,
  RemoteStore,
  ScoredMemory,
  UtilityScored,
  WriteBehindQueue,
} from "./types";
