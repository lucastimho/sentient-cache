"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassPanel } from "./GlassPanel";
import { LatencyVitalsPanel } from "./LatencyVitalsPanel";
import { SearchBar } from "./SearchBar";
import { StarField } from "./StarField";
import { SyncStatusPanel } from "./SyncStatusPanel";
import { generateMockMemories } from "@/lib/memories";
import type { HudMemory, LatencySample, SyncJob } from "@/lib/types";

const MemoryGalaxy = dynamic(
  () => import("./MemoryGalaxy").then((m) => m.MemoryGalaxy),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center mono text-[11px] uppercase tracking-widest text-[color:var(--color-ink-faint)]">
        initializing webgl context…
      </div>
    ),
  },
);

const SAMPLE_WINDOW_MS = 1_800;

export function HudConsole() {
  const [memories, setMemories] = useState<HudMemory[]>([]);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [goal, setGoal] = useState<Float32Array | null>(null);
  const [samples, setSamples] = useState<LatencySample[]>([]);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [currentMs, setCurrentMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seeded = await generateMockMemories(420);
      if (!cancelled) setMemories(seeded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Synthetic edge-retrieval telemetry: every SAMPLE_WINDOW_MS we roll a new
    // latency value clustered around 2–9ms with occasional 11–18ms spikes for
    // cold-cache reads. Replace with a real /metrics subscription once the
    // ingestor exposes one.
    const tick = () => {
      const base = 2 + Math.random() * 6;
      const spike = Math.random() < 0.12 ? 6 + Math.random() * 9 : 0;
      const edgeMs = base + spike;
      setSamples((prev) => {
        const next = [
          ...prev,
          {
            at: Date.now(),
            edgeMs,
            source: spike > 0 ? "refresh-ahead" : "local-cache",
          } as LatencySample,
        ];
        return next.length > 180 ? next.slice(-180) : next;
      });
      setCurrentMs(edgeMs);
    };
    tick();
    const id = setInterval(tick, SAMPLE_WINDOW_MS);
    return () => clearInterval(id);
  }, []);

  const handleSearchResults = useCallback(
    (ids: Set<string>, nextGoal: Float32Array | null, latencyMs: number) => {
      setHighlighted(ids);
      setGoal(nextGoal);
      if (latencyMs > 0) {
        setSamples((prev) =>
          [
            ...prev,
            {
              at: Date.now(),
              edgeMs: latencyMs,
              source: "local-cache" as const,
            },
          ].slice(-180),
        );
      }
    },
    [],
  );

  const handleLocalIngest = useCallback(
    (memory: HudMemory) => {
      setMemories((prev) => [memory, ...prev].slice(0, 800));
      setJobs((prev) => [
        ...prev,
        {
          id: memory.id,
          memoryId: memory.id,
          enqueuedAt: Date.now(),
          attempts: 0,
          state: "pending",
        },
      ]);
    },
    [],
  );

  const handleJobComplete = useCallback(
    (jobId: string) => {
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, state: "done" as const } : j)),
      );
      setMemories((prev) =>
        prev.map((m) => (m.id === jobId ? { ...m, syncState: "synced" as const } : m)),
      );
      setTimeout(() => {
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      }, 1_200);
    },
    [],
  );

  const counts = useMemo(() => {
    return {
      total: memories.length,
      archive: memories.filter((m) => m.partition === "archive").length,
      working: memories.filter((m) => m.partition === "working").length,
      avgImportance:
        memories.length === 0
          ? 0
          : memories.reduce((s, m) => s + m.importance, 0) / memories.length,
    };
  }, [memories]);

  return (
    <>
      <StarField />
      <main className="relative min-h-dvh w-full overflow-hidden">
        <header className="pointer-events-none absolute left-6 right-6 top-6 z-20 flex items-start justify-between">
          <div>
            <div className="mono text-[10px] tracking-[0.3em] uppercase text-[color:var(--color-ink-faint)]">
              sentient-cache
            </div>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-[color:var(--color-ink)] glow-text">
              Edge Memory Console
            </h1>
          </div>
          <div className="mono flex gap-4 rounded-xl border border-[color:var(--color-glass-edge)] bg-[color:var(--color-glass-bg-strong)]/60 px-4 py-2 text-[11px] text-[color:var(--color-ink-dim)] backdrop-blur-xl">
            <Stat label="nodes" value={counts.total.toLocaleString()} />
            <Sep />
            <Stat label="working" value={counts.working.toString()} />
            <Sep />
            <Stat label="archive" value={counts.archive.toString()} />
            <Sep />
            <Stat
              label="avg importance"
              value={counts.avgImportance.toFixed(2)}
              accent
            />
          </div>
        </header>

        <section className="absolute inset-0">
          <MemoryGalaxy
            memories={memories}
            highlighted={highlighted}
            goal={goal}
            className="h-full w-full"
          />
        </section>

        <aside className="absolute right-6 top-28 bottom-6 z-10 flex w-[22rem] flex-col gap-4">
          <SearchBar memories={memories} onResults={handleSearchResults} />
          <LatencyVitalsPanel samples={samples} currentMs={currentMs} />
          <SyncStatusPanel
            pendingJobs={jobs}
            onLocalIngest={handleLocalIngest}
            onJobComplete={handleJobComplete}
          />
        </aside>

        <aside className="absolute bottom-6 left-6 z-10 w-[19rem]">
          <GlassPanel
            title="Memory Heatmap"
            subtitle="Brightness ∝ Semantic Utility"
            accent={
              <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--color-ink-faint)]">
                U = (S × C) / T
              </span>
            }
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mono text-[11px]">
              <dt className="text-[color:var(--color-ink-faint)]">projection</dt>
              <dd className="text-right text-[color:var(--color-ink-dim)]">
                384-d → 3-d fold
              </dd>
              <dt className="text-[color:var(--color-ink-faint)]">star size</dt>
              <dd className="text-right text-[color:var(--color-ink-dim)]">
                utility × importance
              </dd>
              <dt className="text-[color:var(--color-ink-faint)]">hot color</dt>
              <dd className="text-right text-[color:var(--color-accent)] glow-text">
                sky · starlight
              </dd>
              <dt className="text-[color:var(--color-ink-faint)]">search</dt>
              <dd className="text-right text-[color:var(--color-ink-dim)]">
                on-device WASM
              </dd>
            </dl>
          </GlassPanel>
        </aside>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className="text-[9px] uppercase tracking-widest text-[color:var(--color-ink-faint)]">
        {label}
      </span>
      <span
        className={
          accent
            ? "text-[color:var(--color-accent)] glow-text"
            : "text-[color:var(--color-ink)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function Sep() {
  return <span className="self-center text-[color:var(--color-glass-edge)]">·</span>;
}
