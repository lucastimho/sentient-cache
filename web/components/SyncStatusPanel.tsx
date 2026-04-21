"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { GlassPanel } from "./GlassPanel";
import { ingest, isBackendConfigured } from "@/lib/api";
import type { HudMemory, SyncJob } from "@/lib/types";
import { getClientEmbedder } from "@/lib/embedder";

interface SyncStatusPanelProps {
  pendingJobs: SyncJob[];
  onLocalIngest: (memory: HudMemory) => void;
  onJobComplete: (jobId: string) => void;
}

const QK_QUEUE = ["sync-queue"] as const;

export function SyncStatusPanel({
  pendingJobs,
  onLocalIngest,
  onJobComplete,
}: SyncStatusPanelProps) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();

  const queueQuery = useQuery<SyncJob[]>({
    queryKey: QK_QUEUE,
    queryFn: async () => pendingJobs,
    refetchInterval: 1_000,
    initialData: pendingJobs,
  });

  const mutation = useMutation({
    mutationFn: async (content: string) => {
      const embedder = getClientEmbedder();
      const embedding = await embedder.embed(content);
      const localId = `local-${Math.random().toString(36).slice(2, 10)}`;

      // Optimistically paint the node in the galaxy BEFORE any network I/O —
      // matches the AP-consistent, write-behind contract of the backend.
      const memory: HudMemory = {
        id: localId,
        content,
        embedding,
        importance: 1,
        accessCount: 0,
        lastAccessedAt: Date.now(),
        createdAt: Date.now(),
        sizeBytes: content.length * 4 + embedding.byteLength,
        partition: "working",
        syncState: "syncing",
      };
      onLocalIngest(memory);

      if (!isBackendConfigured()) {
        await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
        return { id: localId, remoteId: localId };
      }

      const res = await ingest({ content });
      return { id: localId, remoteId: res.id };
    },
    onSuccess: ({ id }) => {
      onJobComplete(id);
      queryClient.invalidateQueries({ queryKey: QK_QUEUE });
    },
  });

  const inFlight = queueQuery.data?.filter((j) => j.state !== "done") ?? [];
  const isSyncing = mutation.isPending || inFlight.length > 0;

  return (
    <GlassPanel
      title="Write-Behind Queue"
      subtitle={
        isSyncing ? `Syncing ${inFlight.length} to edge` : "Quiescent — all persisted"
      }
      accent={
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isSyncing
                ? "bg-[color:var(--color-accent)] pulse-glow"
                : "bg-[color:var(--color-success)]"
            }`}
          />
          <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--color-ink-faint)]">
            {isSyncing ? "flushing" : "idle"}
          </span>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const content = draft.trim();
          if (!content) return;
          mutation.mutate(content);
          setDraft("");
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ingest a new thought…"
          className="mono flex-1 rounded-md border border-[color:var(--color-glass-edge)]/70 bg-[color:var(--color-nebula-deep)]/60 px-3 py-2 text-sm text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] outline-none focus:border-[color:var(--color-accent)]/60 focus:ring-1 focus:ring-[color:var(--color-accent)]/40"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !draft.trim()}
          className="mono rounded-md border border-[color:var(--color-accent)]/60 bg-[color:var(--color-accent)]/20 px-3 py-2 text-[11px] uppercase tracking-widest text-[color:var(--color-star-core)] glow-text transition disabled:opacity-40 hover:bg-[color:var(--color-accent)]/30"
        >
          ingest
        </button>
      </form>

      <ul className="mt-4 space-y-1.5 max-h-40 overflow-auto pr-1">
        {inFlight.length === 0 && (
          <li className="mono text-[11px] text-[color:var(--color-ink-faint)]">
            no pending writes — edge ↔ central in sync
          </li>
        )}
        {inFlight.slice(-8).map((job) => (
          <li
            key={job.id}
            className="flex items-center justify-between rounded-md border border-[color:var(--color-glass-edge)]/40 bg-[color:var(--color-glass-bg-strong)]/40 px-2.5 py-1.5"
          >
            <span className="mono text-[11px] text-[color:var(--color-ink-dim)] truncate">
              {job.memoryId}
            </span>
            <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--color-accent-dim)] pulse-glow">
              {job.state}
            </span>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
