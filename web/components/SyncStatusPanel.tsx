"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useRef, useState } from "react";
import { Panel } from "./Panel";
import { ingest, isBackendConfigured } from "@/lib/api";
import type { HudMemory, SyncJob } from "@/lib/types";
import { getClientEmbedder } from "@/lib/embedder";

interface SyncStatusPanelProps {
  pendingJobs: SyncJob[];
  onLocalIngest: (memory: HudMemory) => void;
  onJobComplete: (jobId: string) => void;
  onJobError: (jobId: string) => void;
}

const QK_QUEUE = ["sync-queue"] as const;
const MAX_INGEST_LEN = 600;

export const SyncStatusPanel = forwardRef<HTMLInputElement, SyncStatusPanelProps>(
  function SyncStatusPanel(
    { pendingJobs, onLocalIngest, onJobComplete, onJobError }: SyncStatusPanelProps,
    forwardedRef,
  ) {
    const [draft, setDraft] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const inFlightIdRef = useRef<string | null>(null);
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
        inFlightIdRef.current = localId;

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
        inFlightIdRef.current = null;
        setErrorMessage(null);
        queryClient.invalidateQueries({ queryKey: QK_QUEUE });
      },
      onError: (err) => {
        const id = inFlightIdRef.current;
        if (id) onJobError(id);
        inFlightIdRef.current = null;
        setErrorMessage(
          err instanceof Error ? err.message : "Ingest failed — write was not persisted.",
        );
      },
    });

    const inFlight = queueQuery.data?.filter((j) => j.state !== "done") ?? [];
    const errored = inFlight.filter((j) => j.state === "error");
    const isSyncing = mutation.isPending || (inFlight.length > 0 && errored.length === 0);

    const trimmed = draft.trim();
    const overLimit = trimmed.length > MAX_INGEST_LEN;
    const submitDisabled = mutation.isPending || trimmed.length === 0 || overLimit;

    return (
      <Panel
        title="Write-behind queue"
        subtitle={
          errored.length > 0
            ? `${errored.length} write${errored.length === 1 ? "" : "s"} failed`
            : isSyncing
              ? `Flushing ${inFlight.length} write${inFlight.length === 1 ? "" : "s"}`
              : "All writes flushed"
        }
        accent={
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                errored.length > 0
                  ? "bg-[color:var(--color-down)]"
                  : isSyncing
                    ? "bg-[color:var(--color-accent)] blink"
                    : "bg-[color:var(--color-up)]"
              }`}
            />
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
              {errored.length > 0 ? "stuck" : isSyncing ? "flushing" : "idle"}
            </span>
          </div>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (submitDisabled) return;
            setErrorMessage(null);
            mutation.mutate(trimmed);
            setDraft("");
          }}
          className="flex flex-col gap-2"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
              Add a memory
            </span>
            <div className="relative">
              <input
                ref={forwardedRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. context from yesterday's debugging session"
                aria-invalid={overLimit || Boolean(errorMessage)}
                aria-describedby={
                  overLimit
                    ? "ingest-overlimit"
                    : errorMessage
                      ? "ingest-error"
                      : undefined
                }
                className="w-full border border-[color:var(--color-rule)] bg-[color:var(--color-bg-deep)] px-3 py-2 pr-9 text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-mute)] outline-none transition focus:border-[color:var(--color-accent)]/70"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 border border-[color:var(--color-rule)] bg-[color:var(--color-panel-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
                i
              </kbd>
            </div>
          </label>

          <div className="flex items-center justify-between text-[10px] text-[color:var(--color-ink-mute)]">
            <span
              className={
                overLimit ? "text-[color:var(--color-down)]" : undefined
              }
              id="ingest-overlimit"
            >
              {trimmed.length}/{MAX_INGEST_LEN}
            </span>
            <button
              type="submit"
              disabled={submitDisabled}
              className="inline-flex items-center border border-[color:var(--color-accent)]/70 bg-[color:var(--color-accent)]/15 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-accent)] transition disabled:cursor-not-allowed disabled:opacity-30 enabled:hover:bg-[color:var(--color-accent)]/25 enabled:active:translate-y-px"
            >
              {mutation.isPending ? "ingesting…" : "ingest"}
            </button>
          </div>

          {errorMessage && (
            <p
              id="ingest-error"
              role="alert"
              className="border-l-2 border-[color:var(--color-down)] bg-[color:var(--color-down)]/8 px-2.5 py-1.5 text-[11px] text-[color:var(--color-down)]"
            >
              {errorMessage}
            </p>
          )}
        </form>

        <ul className="mt-3 space-y-1 max-h-40 overflow-auto pr-1 border-t border-[color:var(--color-rule-soft)] pt-2">
          {inFlight.length === 0 && (
            <li className="text-[11px] text-[color:var(--color-ink-mute)]">
              No pending writes — local and remote are in sync.
            </li>
          )}
          {inFlight.slice(-8).map((job) => {
            const isError = job.state === "error";
            return (
              <li
                key={job.id}
                className={`flex items-center justify-between border-l-2 px-2.5 py-1 ${
                  isError
                    ? "border-[color:var(--color-down)] bg-[color:var(--color-down)]/8"
                    : "border-[color:var(--color-rule)] bg-[color:var(--color-bg-deep)]/40"
                }`}
              >
                <span className="text-[11px] text-[color:var(--color-ink-dim)] truncate num">
                  {job.memoryId}
                </span>
                <span
                  className={`text-[10px] uppercase tracking-[0.14em] ${
                    isError
                      ? "text-[color:var(--color-down)]"
                      : "text-[color:var(--color-accent-dim)] flicker"
                  }`}
                >
                  {job.state}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    );
  },
);
