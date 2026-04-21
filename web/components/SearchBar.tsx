"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { GlassPanel } from "./GlassPanel";
import { cosine, getClientEmbedder } from "@/lib/embedder";
import type { HudMemory } from "@/lib/types";

interface SearchBarProps {
  memories: HudMemory[];
  onResults: (ids: Set<string>, goal: Float32Array | null, latencyMs: number) => void;
}

const TOP_K = 12;
const DEBOUNCE_MS = 150;

export function SearchBar({ memories, onResults }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setMatchCount(0);
      setLastLatencyMs(null);
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
    onResults(ids, goal, latency);
  }

  return (
    <GlassPanel
      title="Intent Search"
      subtitle="Embed locally — raw text never leaves the device"
      accent={
        <div className="flex items-center gap-2">
          {isPending && (
            <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--color-accent-dim)] pulse-glow">
              embedding
            </span>
          )}
          {lastLatencyMs !== null && !isPending && (
            <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--color-success)]">
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
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="…reflecting on a topic, a task, a regret"
            className="mono w-full rounded-md border border-[color:var(--color-glass-edge)]/80 bg-[color:var(--color-nebula-deep)]/70 px-3 py-2.5 pr-14 text-sm text-[color:var(--color-ink)] placeholder:text-[color:var(--color-ink-faint)] outline-none transition focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]/50"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[color:var(--color-glass-edge)]/80 bg-[color:var(--color-glass-bg-strong)] px-1.5 py-0.5 mono text-[10px] text-[color:var(--color-ink-faint)]">
            WASM
          </kbd>
        </div>
      </label>

      <div className="mt-3 flex items-center justify-between mono text-[11px] text-[color:var(--color-ink-faint)]">
        <span>
          {query.trim() === "" ? (
            "384-dim client-side embedder ready"
          ) : matchCount > 0 ? (
            <>
              highlighted{" "}
              <span className="text-[color:var(--color-accent)] glow-text">
                {matchCount}
              </span>{" "}
              / {memories.length}
            </>
          ) : (
            "no semantic matches"
          )}
        </span>
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="uppercase tracking-widest hover:text-[color:var(--color-ink-dim)]"
          >
            clear
          </button>
        )}
      </div>
    </GlassPanel>
  );
}
