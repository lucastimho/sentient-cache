import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import {
  CapabilityTableEvaluator,
  HttpOpaEvaluator,
  type CapabilityTable,
  type OpaEvaluator,
  type PolicyInput,
} from "../src/security/OpaEvaluator";
import { opaMiddleware, getAgentId } from "../src/security/opaMiddleware";

function appWith(evaluator: OpaEvaluator): Hono {
  const app = new Hono();
  app.use("*", opaMiddleware({ evaluator }));
  app.post("/ingest", (c) => c.json({ ok: true, agent: getAgentId(c) }));
  app.post("/search", (c) => c.json({ ok: true, agent: getAgentId(c) }));
  return app;
}

const TABLE: CapabilityTable = {
  "agent-alpha": { "public": ["read", "search"], "journal": ["read", "write", "search"] },
  "agent-beta": { "public": ["read", "search"] },
};

describe("CapabilityTableEvaluator", () => {
  const ev = new CapabilityTableEvaluator({ table: TABLE });

  test("allows operation explicitly listed for an agent+tag", async () => {
    const d = await ev.allow({ agentId: "agent-alpha", operation: "write", memoryTag: "journal" });
    expect(d.allow).toBe(true);
  });

  test("denies operation not listed for the tag", async () => {
    const d = await ev.allow({ agentId: "agent-beta", operation: "write", memoryTag: "journal" });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/write/);
  });

  test("denies unknown agents outright", async () => {
    const d = await ev.allow({ agentId: "ghost", operation: "read", memoryTag: "public" });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/unknown/);
  });
});

describe("opaMiddleware", () => {
  const ev = new CapabilityTableEvaluator({ table: TABLE });
  const app = appWith(ev);

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(
      new Request(`http://test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  test("returns 401 when no agent header is present", async () => {
    const res = await post("/ingest", { content: "x", memory_tag: "public" });
    expect(res.status).toBe(401);
  });

  test("returns 403 when the capability is missing", async () => {
    const res = await post(
      "/ingest",
      { content: "x", memory_tag: "journal" },
      { "x-agent-id": "agent-beta" },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toMatch(/write/);
  });

  test("passes through when the capability exists and records the agent id", async () => {
    const res = await post(
      "/ingest",
      { content: "x", memory_tag: "journal" },
      { "x-agent-id": "agent-alpha" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: string };
    expect(body.agent).toBe("agent-alpha");
  });

  test("infers operation from path: /search → search", async () => {
    const res = await post(
      "/search",
      { query: "x", memory_tag: "public" },
      { "x-agent-id": "agent-beta" },
    );
    expect(res.status).toBe(200);
  });

  test("reads memory tag from the x-memory-tag header when the body omits it", async () => {
    const res = await post(
      "/ingest",
      { content: "x" },
      { "x-agent-id": "agent-alpha", "x-memory-tag": "journal" },
    );
    expect(res.status).toBe(200);
  });
});

describe("HttpOpaEvaluator", () => {
  test("serializes input and maps a true primitive result to allow", async () => {
    let captured: PolicyInput | undefined;
    const mockFetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { input: PolicyInput };
      captured = body.input;
      return new Response(JSON.stringify({ result: true }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const ev = new HttpOpaEvaluator({
      url: "http://opa/v1/data/sg/memory/allow",
      fetchImpl: mockFetch,
    });
    const d = await ev.allow({ agentId: "a", operation: "read", memoryTag: "t" });
    expect(d.allow).toBe(true);
    expect(captured).toEqual({ agentId: "a", operation: "read", memoryTag: "t" });
  });

  test("maps {allow, reason} object result through", async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ result: { allow: false, reason: "blocked" } }))) as unknown as typeof fetch;
    const ev = new HttpOpaEvaluator({ url: "http://opa", fetchImpl: mockFetch });
    const d = await ev.allow({ agentId: "a", operation: "read" });
    expect(d).toEqual({ allow: false, reason: "blocked" });
  });

  test("denies when OPA returns non-ok", async () => {
    const mockFetch = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const ev = new HttpOpaEvaluator({ url: "http://opa", fetchImpl: mockFetch });
    const d = await ev.allow({ agentId: "a", operation: "read" });
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/500/);
  });
});
