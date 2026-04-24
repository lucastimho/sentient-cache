import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import {
  ResourceSentinel,
  resourceSentinelMiddleware,
} from "../src/security/ResourceSentinel";

describe("ResourceSentinel", () => {
  test("admits under the queue limit and tracks pending bytes", () => {
    const s = new ResourceSentinel({ queueLimitBytes: 1000 });
    const t1 = s.admit(400);
    expect(t1.admitted).toBe(true);
    expect(s.snapshot().pendingBytes).toBe(400);
    const t2 = s.admit(400);
    expect(t2.admitted).toBe(true);
    expect(s.snapshot().pendingBytes).toBe(800);
  });

  test("rejects when an admit would cross the queue limit", () => {
    const s = new ResourceSentinel({ queueLimitBytes: 1000 });
    s.admit(600);
    const rejected = s.admit(500);
    expect(rejected.admitted).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  test("release decrements pending bytes so a subsequent admit can succeed", () => {
    const s = new ResourceSentinel({ queueLimitBytes: 1000 });
    const t = s.admit(800);
    expect(t.admitted).toBe(true);
    t.release();
    expect(s.snapshot().pendingBytes).toBe(0);
    const t2 = s.admit(800);
    expect(t2.admitted).toBe(true);
  });

  test("release is idempotent", () => {
    const s = new ResourceSentinel({ queueLimitBytes: 1000 });
    const t = s.admit(400);
    t.release();
    t.release();
    expect(s.snapshot().pendingBytes).toBe(0);
  });

  test("consecutive rejections increase exponential backoff up to the cap", () => {
    const s = new ResourceSentinel({
      queueLimitBytes: 100,
      baseRetryMs: 100,
      maxRetryMs: 2_000,
    });
    s.admit(200);
    const a = s.admit(200);
    const b = s.admit(200);
    const c = s.admit(200);
    expect(a.retryAfterMs!).toBeLessThan(b.retryAfterMs!);
    expect(b.retryAfterMs!).toBeLessThan(c.retryAfterMs!);
    for (let i = 0; i < 20; i++) s.admit(200);
    const late = s.admit(200);
    expect(late.retryAfterMs!).toBe(2_000);
  });
});

describe("resourceSentinelMiddleware", () => {
  function appWith(sentinel: ResourceSentinel): Hono {
    const app = new Hono();
    app.use("*", resourceSentinelMiddleware({ sentinel }));
    app.post("/ingest", async (c) => {
      await c.req.json().catch(() => ({}));
      return c.json({ ok: true });
    });
    return app;
  }

  const postOfSize = (bytes: number, extraHeaders: Record<string, string> = {}) =>
    new Request("http://test/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(bytes),
        ...extraHeaders,
      },
      body: "x".repeat(Math.max(0, bytes - 2)).padStart(bytes, "{"),
    });

  test("returns 503 with Retry-After when over the queue limit", async () => {
    const sentinel = new ResourceSentinel({ queueLimitBytes: 1024 });
    const app = appWith(sentinel);

    const a = await app.request(postOfSize(600));
    expect(a.status).toBe(200);
    // second request doesn't release until after next() resolves — since the
    // first response has already been awaited, its ticket released before b
    // runs; simulate concurrent pressure by leaving no gap
    const b = await app.request(postOfSize(2000));
    expect(b.status).toBe(503);
    expect(b.headers.get("retry-after")).not.toBeNull();
    const body = (await b.json()) as { error: string; retry_after_ms: number };
    expect(body.error).toBe("server_busy");
    expect(body.retry_after_ms).toBeGreaterThan(0);
  });

  test("allows traffic to resume once pressure clears", async () => {
    const sentinel = new ResourceSentinel({ queueLimitBytes: 1024 });
    const app = appWith(sentinel);

    const first = await app.request(postOfSize(600));
    expect(first.status).toBe(200);
    expect(sentinel.snapshot().pendingBytes).toBe(0);
    const second = await app.request(postOfSize(600));
    expect(second.status).toBe(200);
  });
});
