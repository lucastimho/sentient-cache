import { Queue, type JobsOptions } from "bullmq";
import type IORedis from "ioredis";
import type { WriteBehindQueue } from "../types";

export const SYNC_JOB_NAME = "sync-batch";
export const SYNC_QUEUE_NAME = "sentient-cache-sync";

export interface SyncJobData {
  ids: string[];
  enqueuedAt: number;
}

export interface BullWriteBehindQueueOptions {
  connection: IORedis | { host: string; port: number; password?: string };
  queueName?: string;
  defaultJobOptions?: JobsOptions;
}

export class BullWriteBehindQueue implements WriteBehindQueue {
  private readonly queue: Queue<SyncJobData>;

  constructor(opts: BullWriteBehindQueueOptions) {
    this.queue = new Queue<SyncJobData>(opts.queueName ?? SYNC_QUEUE_NAME, {
      connection: opts.connection as IORedis,
      defaultJobOptions: opts.defaultJobOptions ?? {
        attempts: 5,
        backoff: { type: "exponential", delay: 500 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }

  async enqueueBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.queue.add(SYNC_JOB_NAME, { ids, enqueuedAt: Date.now() });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
