export type MemoryOperation = "read" | "write" | "search" | "delete";

export interface PolicyInput {
  agentId: string;
  operation: MemoryOperation;
  memoryTag?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

export interface OpaEvaluator {
  allow(input: PolicyInput): Promise<PolicyDecision>;
}

export interface HttpOpaEvaluatorOptions {
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpOpaEvaluator implements OpaEvaluator {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HttpOpaEvaluatorOptions) {
    this.url = opts.url;
    this.timeoutMs = opts.timeoutMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async allow(input: PolicyInput): Promise<PolicyDecision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });
      if (!res.ok) return { allow: false, reason: `opa http ${res.status}` };
      const raw = (await res.json()) as { result?: unknown };
      return normalizeOpaResult(raw?.result);
    } catch (err) {
      return { allow: false, reason: (err as Error).message ?? "opa fetch failed" };
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeOpaResult(result: unknown): PolicyDecision {
  if (typeof result === "boolean") return { allow: result };
  if (result && typeof result === "object") {
    const r = result as { allow?: unknown; reason?: unknown };
    return {
      allow: Boolean(r.allow),
      reason: typeof r.reason === "string" ? r.reason : undefined,
    };
  }
  return { allow: false, reason: "opa response malformed" };
}

export type CapabilityTable = Record<
  string,
  Record<string, MemoryOperation[]>
>;

export interface CapabilityTableEvaluatorOptions {
  table: CapabilityTable;
  wildcardTag?: string;
}

export class CapabilityTableEvaluator implements OpaEvaluator {
  private readonly table: CapabilityTable;
  private readonly wildcardTag: string;

  constructor(opts: CapabilityTableEvaluatorOptions) {
    this.table = opts.table;
    this.wildcardTag = opts.wildcardTag ?? "*";
  }

  async allow(input: PolicyInput): Promise<PolicyDecision> {
    const agentCaps = this.table[input.agentId];
    if (!agentCaps) return { allow: false, reason: `unknown agent ${input.agentId}` };

    const tag = input.memoryTag ?? this.wildcardTag;
    const direct = agentCaps[tag] ?? [];
    const wildcard = agentCaps[this.wildcardTag] ?? [];
    const caps = new Set<MemoryOperation>([...direct, ...wildcard]);

    if (caps.has(input.operation)) return { allow: true };
    return {
      allow: false,
      reason: `${input.agentId} lacks ${input.operation} on ${tag}`,
    };
  }
}
