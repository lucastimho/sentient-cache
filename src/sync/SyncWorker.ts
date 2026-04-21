import { Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { SYNC_JOB_NAME, SYNC_QUEUE_NAME, type SyncJobData } from "./WriteBehindQueue";
import type { SemanticCache } from "../cache/SemanticCache";
import type { RemoteStore } from "../types";

export interface SyncWorkerOptions {
  cache: SemanticCache;
  remote: RemoteStore;
  connection: IORedis | { host: string; port: number; password?: string };
  queueName?: string;
  concurrency?: number;
}

export class SyncWorker {
  private readonly worker: Worker<SyncJobData>;

  constructor(opts: SyncWorkerOptions) {
    this.worker = new Worker<SyncJobData>(
      opts.queueName ?? SYNC_QUEUE_NAME,
      async (job: Job<SyncJobData>) => {
        if (job.name !== SYNC_JOB_NAME) return;
        const memories = opts.cache.readDirtyMemories(job.data.ids);
        if (memories.length === 0) return;
        await opts.remote.writeBatch(memories);
        opts.cache.markSynced(memories.map((m) => m.id));
      },
      {
        connection: opts.connection as IORedis,
        concurrency: opts.concurrency ?? 4,
      },
    );
  }

  on(event: "completed" | "failed" | "error", handler: (...args: unknown[]) => void): void {
    this.worker.on(event as "completed", handler as never);
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
