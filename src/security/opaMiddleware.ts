import type { Context, MiddlewareHandler } from "hono";
import type { MemoryOperation, OpaEvaluator, PolicyDecision } from "./OpaEvaluator";
import { getCachedBody } from "../ingestor/refreshAhead";

export interface OpaMiddlewareOptions {
  evaluator: OpaEvaluator;
  agentHeader?: string;
  tagHeader?: string;
  inferOperation?: (c: Context) => MemoryOperation;
  onDeny?: (decision: PolicyDecision, input: ReturnType<typeof describeRequest>) => void;
}

const AGENT_CTX = "sg.agentId";
const DECISION_CTX = "sg.decision";

type RequestDescription = {
  path: string;
  method: string;
  agentId: string | undefined;
  memoryTag: string | undefined;
  operation: MemoryOperation;
};

export function describeRequest(
  c: Context,
  opts: OpaMiddlewareOptions,
): RequestDescription {
  const agentHeader = opts.agentHeader ?? "x-agent-id";
  const tagHeader = opts.tagHeader ?? "x-memory-tag";
  const agentId = c.req.header(agentHeader) ?? undefined;
  const memoryTag =
    c.req.header(tagHeader) ?? c.req.query("memory_tag") ?? undefined;
  const operation = opts.inferOperation?.(c) ?? defaultInferOperation(c);
  return {
    path: c.req.path,
    method: c.req.method,
    agentId,
    memoryTag,
    operation,
  };
}

function defaultInferOperation(c: Context): MemoryOperation {
  const path = c.req.path;
  const method = c.req.method.toUpperCase();
  if (path.endsWith("/search")) return "search";
  if (path.endsWith("/ingest")) return "write";
  if (method === "DELETE") return "delete";
  return "read";
}

export function opaMiddleware(opts: OpaMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const desc = describeRequest(c, opts);

    if (!desc.agentId) {
      return c.json({ error: "missing agent id" }, 401);
    }

    let memoryTag = desc.memoryTag;
    if (!memoryTag && c.req.method !== "GET") {
      const body = await getCachedBody<{ memory_tag?: string }>(c);
      if (body && typeof body.memory_tag === "string") memoryTag = body.memory_tag;
    }

    const decision = await opts.evaluator.allow({
      agentId: desc.agentId,
      operation: desc.operation,
      memoryTag,
    });

    if (!decision.allow) {
      opts.onDeny?.(decision, { ...desc, memoryTag });
      return c.json(
        { error: "forbidden", reason: decision.reason ?? "policy denied" },
        403,
      );
    }

    c.set(AGENT_CTX, desc.agentId);
    c.set(DECISION_CTX, decision);
    await next();
  };
}

export function getAgentId(c: Context): string | undefined {
  return c.get(AGENT_CTX) as string | undefined;
}
