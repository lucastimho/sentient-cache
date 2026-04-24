import type { Context, MiddlewareHandler } from "hono";

export interface ResourceSentinelOptions {
  queueLimitBytes?: number;
  rssLimitBytes?: number;
  baseRetryMs?: number;
  maxRetryMs?: number;
  now?: () => number;
}

export interface SentinelSnapshot {
  pendingBytes: number;
  queueLimitBytes: number;
  rssBytes: number;
  rssLimitBytes: number;
  overLimit: boolean;
  rssOverLimit: boolean;
  consecutiveRejections: number;
}

export interface AdmissionTicket {
  admitted: boolean;
  retryAfterMs?: number;
  release: () => void;
}

const DEFAULT_QUEUE_LIMIT = 100 * 1024 * 1024;
const DEFAULT_BASE_RETRY = 200;
const DEFAULT_MAX_RETRY = 15_000;

export class ResourceSentinel {
  private readonly queueLimitBytes: number;
  private readonly rssLimitBytes: number;
  private readonly baseRetryMs: number;
  private readonly maxRetryMs: number;
  private readonly now: () => number;

  private pendingBytes = 0;
  private consecutiveRejections = 0;

  constructor(opts: ResourceSentinelOptions = {}) {
    this.queueLimitBytes = opts.queueLimitBytes ?? DEFAULT_QUEUE_LIMIT;
    this.rssLimitBytes = opts.rssLimitBytes ?? Infinity;
    this.baseRetryMs = opts.baseRetryMs ?? DEFAULT_BASE_RETRY;
    this.maxRetryMs = opts.maxRetryMs ?? DEFAULT_MAX_RETRY;
    this.now = opts.now ?? Date.now;
  }

  admit(sizeBytes: number): AdmissionTicket {
    const rss = this.readRss();
    const projected = this.pendingBytes + sizeBytes;
    const overQueue = projected > this.queueLimitBytes;
    const overRss = rss > this.rssLimitBytes;

    if (overQueue || overRss) {
      this.consecutiveRejections++;
      const retryAfterMs = this.computeRetry();
      return {
        admitted: false,
        retryAfterMs,
        release: () => {},
      };
    }

    this.pendingBytes = projected;
    this.consecutiveRejections = 0;
    let released = false;
    return {
      admitted: true,
      release: () => {
        if (released) return;
        released = true;
        this.pendingBytes = Math.max(0, this.pendingBytes - sizeBytes);
      },
    };
  }

  snapshot(): SentinelSnapshot {
    const rss = this.readRss();
    return {
      pendingBytes: this.pendingBytes,
      queueLimitBytes: this.queueLimitBytes,
      rssBytes: rss,
      rssLimitBytes: this.rssLimitBytes,
      overLimit: this.pendingBytes > this.queueLimitBytes,
      rssOverLimit: rss > this.rssLimitBytes,
      consecutiveRejections: this.consecutiveRejections,
    };
  }

  private computeRetry(): number {
    const exp = Math.min(this.consecutiveRejections, 8);
    const backoff = this.baseRetryMs * 2 ** exp;
    return Math.min(this.maxRetryMs, backoff);
  }

  private readRss(): number {
    try {
      return process.memoryUsage().rss;
    } catch {
      return 0;
    }
  }
}

export interface SentinelMiddlewareOptions {
  sentinel: ResourceSentinel;
  fallbackSizeBytes?: number;
}

export function resourceSentinelMiddleware(
  opts: SentinelMiddlewareOptions,
): MiddlewareHandler {
  const fallback = opts.fallbackSizeBytes ?? 64 * 1024;
  return async (c, next) => {
    const size = estimateSize(c, fallback);
    const ticket = opts.sentinel.admit(size);
    if (!ticket.admitted) {
      c.header("Retry-After", String(Math.ceil((ticket.retryAfterMs ?? 1000) / 1000)));
      return c.json(
        {
          error: "server_busy",
          retry_after_ms: ticket.retryAfterMs,
          snapshot: opts.sentinel.snapshot(),
        },
        503,
      );
    }
    try {
      await next();
    } finally {
      ticket.release();
    }
  };
}

function estimateSize(c: Context, fallback: number): number {
  const header = c.req.header("content-length");
  if (header) {
    const n = Number(header);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return fallback;
}
