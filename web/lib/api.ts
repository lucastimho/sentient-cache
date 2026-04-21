// Thin client to the Bun ingestor. All functions degrade gracefully when the
// backend is unreachable — the HUD must keep rendering on the client even when
// the edge node is partitioned.

const BASE_URL = process.env.NEXT_PUBLIC_INGESTOR_URL ?? "";

export interface IngestPayload {
  content: string;
  importance?: number;
  session_id?: string;
  current_task?: string;
}

export interface IngestResult {
  id: string;
  size_bytes: number;
  importance: number;
  prefetch_triggered: boolean;
}

export interface HealthResult {
  ok: boolean;
  embeddingDims: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) throw new Error("NEXT_PUBLIC_INGESTOR_URL is not configured");
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export function isBackendConfigured(): boolean {
  return Boolean(BASE_URL);
}

export function ingest(payload: IngestPayload): Promise<IngestResult> {
  return call<IngestResult>("/ingest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function health(): Promise<HealthResult> {
  return call<HealthResult>("/healthz");
}

export function setCurrentTask(sessionId: string, task: string): Promise<unknown> {
  return call<unknown>(`/sessions/${encodeURIComponent(sessionId)}/task`, {
    method: "POST",
    body: JSON.stringify({ current_task: task }),
  });
}
