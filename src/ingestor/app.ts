import { Hono } from "hono";
import type { SemanticController } from "../controller/SemanticController";
import type { SessionRegistry } from "../controller/SessionRegistry";
import type { OpaEvaluator } from "../security/OpaEvaluator";
import { opaMiddleware } from "../security/opaMiddleware";
import type { ResourceSentinel } from "../security/ResourceSentinel";
import { resourceSentinelMiddleware } from "../security/ResourceSentinel";
import {
  getCachedBody,
  getRefreshAheadHook,
  refreshAheadMiddleware,
} from "./refreshAhead";

export interface CreateIngestorAppOptions {
  controller: SemanticController;
  registry: SessionRegistry;
  sentinel?: ResourceSentinel;
  opaEvaluator?: OpaEvaluator;
  agentHeader?: string;
}

interface IngestBody {
  content?: string;
  importance?: number;
  id?: string;
  session_id?: string;
  current_task?: string;
}

interface SearchBody {
  query?: string;
  k?: number;
  session_id?: string;
  current_task?: string;
}

interface TaskBody {
  current_task?: string;
}

export function createIngestorApp(opts: CreateIngestorAppOptions): Hono {
  const app = new Hono();
  const { controller, registry } = opts;

  // Order matters: sentinel rejects at the door (cheapest reject), then OPA
  // authenticates/authorizes, then refresh-ahead runs now that we know who
  // the request is for.
  if (opts.sentinel) {
    app.use("*", resourceSentinelMiddleware({ sentinel: opts.sentinel }));
  }
  if (opts.opaEvaluator) {
    app.use(
      "*",
      opaMiddleware({ evaluator: opts.opaEvaluator, agentHeader: opts.agentHeader }),
    );
  }
  app.use("*", refreshAheadMiddleware({ controller, registry }));

  app.get("/healthz", (c) => c.json({ ok: true, embeddingDims: controller.embeddingDimensions }));

  app.post("/ingest", async (c) => {
    const body = (await getCachedBody<IngestBody>(c)) ?? {};
    if (!body.content || typeof body.content !== "string") {
      return c.json({ error: "content is required" }, 400);
    }
    const memory = await controller.ingest({
      id: body.id,
      content: body.content,
      importance: typeof body.importance === "number" ? body.importance : undefined,
    });
    const hook = getRefreshAheadHook(c);
    return c.json({
      id: memory.id,
      size_bytes: memory.sizeBytes,
      importance: memory.importance,
      prefetch_triggered: hook?.fired ?? false,
    });
  });

  app.post("/search", async (c) => {
    const body = (await getCachedBody<SearchBody>(c)) ?? {};
    if (!body.query || typeof body.query !== "string") {
      return c.json({ error: "query is required" }, 400);
    }
    const k = typeof body.k === "number" && body.k > 0 ? Math.min(body.k, 100) : 5;
    const results = await controller.search(body.query, k);
    return c.json({
      results: results.map((r) => ({
        id: r.memory.id,
        content: r.memory.content,
        similarity: r.similarity,
        importance: r.memory.importance,
      })),
    });
  });

  app.post("/sessions/:id/task", async (c) => {
    const sessionId = c.req.param("id");
    const body = (await getCachedBody<TaskBody>(c)) ?? {};
    if (!body.current_task || typeof body.current_task !== "string") {
      return c.json({ error: "current_task is required" }, 400);
    }
    const change = registry.setTask(sessionId, body.current_task);
    const hook = getRefreshAheadHook(c);
    if (change.changed && !hook?.fired) {
      void controller.prefetchForTask(body.current_task).catch(() => {});
    }
    return c.json({
      session_id: sessionId,
      previous_task: change.previous,
      current_task: change.current,
      changed: change.changed,
    });
  });

  return app;
}
