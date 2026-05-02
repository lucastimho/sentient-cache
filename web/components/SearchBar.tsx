"use client";

import { forwardRef, useEffect, useRef, useState, useTransition } from "react";
import { Panel } from "./Panel";
import { cosine, getClientEmbedder } from "@/lib/embedder";
import type { HudMemory } from "@/lib/types";

interface SearchBarProps {
  memories: HudMemory[];
  onResults: (ids: Set<string>, goal: Float32Array | null, latencyMs: number) => void;
}

const TOP_K = 12;
const DEBOUNCE_MS = 150;

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
  { memories, onResults },
  forwardedRef,
) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setMatchCount(0);
      setLastLatencyMs(null);
      setErrorMessage(null);
      onResults(new Set(), null, 0);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(() => {
        void runSearch(query);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, memories]);

  async function runSearch(q: string) {
    try {
      const embedder = getClientEmbedder();
      const start = performance.now();
      const goal = await embedder.embed(q);
      const scored = memories.map((m) => ({ id: m.id, sim: cosine(m.embedding, goal) }));
      scored.sort((a, b) => b.sim - a.sim);
      const top = scored.slice(0, TOP_K).filter((s) => s.sim > 0.05);
      const ids = new Set(top.map((s) => s.id));
      const latency = performance.now() - start;
      setMatchCount(ids.size);
      setLastLatencyMs(latency);
      setErrorMessage(null);
      onResults(ids, goal, latency);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Embedder failed — search results not updated.",
      );
    }
  }

  return (
    <Panel
      title="Search"
      subtitle="On-device embedding · text stays local"
      accent={
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
          {isPending && (
            <span className="text-[color:var(--color-accent-dim)] flicker">embedding</span>
          )}
          {lastLatencyMs !== null && !isPending && (
            <span className="num text-[color:var(--color-up)] normal-case tracking-normal">
              {lastLatencyMs.toFixed(2)} ms
            </span>
          )}
        </div>
      }
    >
      <label className="block">
        <span className="sr-only">Search memories</span>
        <div className="relative">
          <input
            ref={forwardedRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. database migrations last quarter"
            aria-invalid={Boolean(errorMessage)}
            aria-describedby={errorMessage ? "search-error" : undefined}
            className="w-full border border-[color:var(--color-rule)] bg-[color:var(--color-bg-deep)] px-3 py-2 pr-9 text-[13px] text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-mute)] outline-none transition focus:border-[color:var(--color-accent)]/70"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 border border-[color:var(--color-rule)] bg-[color:var(--color-panel-strong)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
            /
          </kbd>
        </div>
      </label>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-[color:var(--color-ink-faint)]">
        <span>
          {query.trim() === "" ? (
            "Type to find semantically similar memories"
          ) : matchCount > 0 ? (
            <>
              <span className="text-[color:var(--color-accent)] num">
                {matchCount}
              </span>{" "}
              of {memories.length} match
            </>
          ) : (
            "No semantic matches"
          )}
        </span>
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-[10px] uppercase tracking-[0.14em] transition hover:text-[color:var(--color-ink-dim)]"
          >
            clear · esc
          </button>
        )}
      </div>

      {errorMessage && (
        <p
          id="search-error"
          role="alert"
          className="mt-2 border-l-2 border-[color:var(--color-down)] bg-[color:var(--color-down)]/8 px-2.5 py-1.5 text-[11px] text-[color:var(--color-down)]"
        >
          {errorMessage}
        </p>
      )}
    </Panel>
  );
});
