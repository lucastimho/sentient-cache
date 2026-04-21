import type { Context, MiddlewareHandler } from "hono";
import type { SemanticController } from "../controller/SemanticController";
import type { SessionRegistry } from "../controller/SessionRegistry";

const BODY_KEY = "sc.body";
const HOOK_KEY = "sc.refreshAhead";

export interface RefreshAheadOptions {
  controller: SemanticController;
  registry: SessionRegistry;
  onError?: (err: unknown) => void;
}

export interface RefreshAheadHook {
  fired: boolean;
  promise: Promise<void> | null;
}

type JsonBody = Record<string, unknown>;

function looksLikeJson(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/json");
}

function readStringField(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const v = (body as JsonBody)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function getCachedBody<T = JsonBody>(c: Context): Promise<T | undefined> {
  const cached = c.get(BODY_KEY) as T | undefined;
  if (cached !== undefined) return cached;
  if (!looksLikeJson(c.req.header("content-type"))) return undefined;
  try {
    const body = (await c.req.json()) as T;
    c.set(BODY_KEY, body);
    return body;
  } catch {
    return undefined;
  }
}

export function refreshAheadMiddleware(opts: RefreshAheadOptions): MiddlewareHandler {
  const onError = opts.onError ?? ((err: unknown) => console.error("[refresh-ahead]", err));
  return async (c, next) => {
    const hook: RefreshAheadHook = { fired: false, promise: null };
    c.set(HOOK_KEY, hook);

    let sessionId = c.req.query("session_id");
    let currentTask = c.req.query("current_task");

    if ((!sessionId || !currentTask) && c.req.method !== "GET") {
      const body = await getCachedBody(c);
      sessionId = sessionId ?? readStringField(body, "session_id");
      currentTask = currentTask ?? readStringField(body, "current_task");
    }

    if (sessionId && currentTask) {
      const change = opts.registry.setTask(sessionId, currentTask);
      if (change.changed) {
        hook.fired = true;
        hook.promise = opts.controller.prefetchForTask(currentTask).catch((err) => {
          onError(err);
        });
      }
    }

    await next();
  };
}

export function getRefreshAheadHook(c: Context): RefreshAheadHook | undefined {
  return c.get(HOOK_KEY) as RefreshAheadHook | undefined;
}
