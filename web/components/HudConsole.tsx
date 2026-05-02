"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LatencyVitalsPanel } from "./LatencyVitalsPanel";
import { MemoryInspector } from "./MemoryInspector";
import { MemoryTooltip } from "./MemoryTooltip";
import { Panel } from "./Panel";
import { SearchBar } from "./SearchBar";
import { StarField } from "./StarField";
import { SyncStatusPanel } from "./SyncStatusPanel";
import { generateMockMemories } from "@/lib/memories";
import type { HudMemory, LatencySample, SyncJob } from "@/lib/types";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import { utility } from "@/lib/utility";

const MemoryGalaxy = dynamic(
  () => import("./MemoryGalaxy").then((m) => m.MemoryGalaxy),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-ink-faint)]">
        initializing webgl context
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
  const [selectedMemory, setSelectedMemory] = useState<HudMemory | null>(null);
  const [hoveredMemory, setHoveredMemory] = useState<HudMemory | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const ingestInputRef = useRef<HTMLInputElement>(null);

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
    const tick = () => {
      const base = 2 + Math.random() * 6;
      const spike = Math.random() < 0.12 ? 6 + Math.random() * 9 : 0;
      const edgeMs = base + spike;
      setSamples((prev) =>
        [
          ...prev,
          {
            at: Date.now(),
            edgeMs,
            source: spike > 0 ? "refresh-ahead" : "local-cache",
          } as LatencySample,
        ].slice(-180),
      );
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

  const handleLocalIngest = useCallback((memory: HudMemory) => {
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
  }, []);

  const handleJobComplete = useCallback((jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, state: "done" as const } : j)),
    );
    setMemories((prev) =>
      prev.map((m) => (m.id === jobId ? { ...m, syncState: "synced" as const } : m)),
    );
    setTimeout(() => {
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    }, 1_200);
  }, []);

  const handleJobError = useCallback((jobId: string) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId ? { ...j, state: "error" as const, attempts: j.attempts + 1 } : j,
      ),
    );
  }, []);

  const handleGalaxyHover = useCallback(
    (mem: HudMemory | null, pos: { x: number; y: number } | null) => {
      setHoveredMemory(mem);
      setHoverPos(pos);
    },
    [],
  );

  const handleGalaxySelect = useCallback((mem: HudMemory | null) => {
    setSelectedMemory(mem);
  }, []);

  useKeyboardShortcuts({
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onFocusIngest: () => {
      ingestInputRef.current?.focus();
    },
    onClearHighlights: () => {
      setHighlighted(new Set());
      setGoal(null);
    },
    onEscape: () => {
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (selectedMemory) {
        setSelectedMemory(null);
        return;
      }
      if (highlighted.size > 0) {
        setHighlighted(new Set());
        setGoal(null);
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    },
  });

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

  const selectedUtility = useMemo(
    () => (selectedMemory ? utility(selectedMemory, goal) : 0),
    [selectedMemory, goal],
  );

  const tooltipUtility = useMemo(
    () => (hoveredMemory ? utility(hoveredMemory, goal) : 0),
    [hoveredMemory, goal],
  );

  const showTooltip =
    hoveredMemory &&
    hoverPos &&
    (!selectedMemory || hoveredMemory.id !== selectedMemory.id);

  return (
    <>
      <StarField />
      <main className="relative min-h-dvh w-full overflow-hidden">
        {/* Top status rail — single hairline-bottomed strip, full width. */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-[color:var(--color-rule)] bg-[color:var(--color-bg)]/85 px-5 py-2.5 backdrop-blur-sm">
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-faint)]">
              SENTIENT-CACHE
            </span>
            <span className="text-[color:var(--color-rule)]">/</span>
            <span className="text-[12px] tracking-tight text-[color:var(--color-ink)]">
              Edge Memory Console
            </span>
          </div>
          <div className="flex items-center gap-5 text-[11px] text-[color:var(--color-ink-dim)] num">
            <Stat label="nodes" value={counts.total.toLocaleString()} />
            <Stat label="working" value={counts.working.toString()} />
            <Stat label="archive" value={counts.archive.toString()} />
            <Stat
              label="μ importance"
              value={counts.avgImportance.toFixed(2)}
              accent
            />
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              className="pointer-events-auto inline-flex h-5 w-5 items-center justify-center border border-[color:var(--color-rule)] text-[10px] text-[color:var(--color-ink-faint)] transition hover:border-[color:var(--color-accent)]/60 hover:text-[color:var(--color-ink)]"
              aria-label="Toggle keyboard shortcuts and legend"
              aria-expanded={helpOpen}
            >
              ?
            </button>
          </div>
        </header>

        {/* Galaxy occupies the full viewport behind the rails. */}
        <section className="absolute inset-0">
          <MemoryGalaxy
            memories={memories}
            highlighted={highlighted}
            goal={goal}
            selectedId={selectedMemory?.id ?? null}
            onHover={handleGalaxyHover}
            onSelect={handleGalaxySelect}
            className="h-full w-full"
          />
        </section>

        {/* Right control column. Anchored to the rail, no rounded floats. */}
        <aside className="absolute right-5 top-16 bottom-5 z-10 flex w-[22rem] flex-col gap-3">
          <SearchBar
            ref={searchInputRef}
            memories={memories}
            onResults={handleSearchResults}
          />
          <LatencyVitalsPanel samples={samples} currentMs={currentMs} />
          <SyncStatusPanel
            ref={ingestInputRef}
            pendingJobs={jobs}
            onLocalIngest={handleLocalIngest}
            onJobComplete={handleJobComplete}
            onJobError={handleJobError}
          />
        </aside>

        {/* Bottom-left detail surface. Selected → inspector. Otherwise empty. */}
        {selectedMemory && (
          <aside className="absolute bottom-5 left-5 z-10 w-[22rem]">
            <MemoryInspector
              memory={selectedMemory}
              utility={selectedUtility}
              onClose={() => setSelectedMemory(null)}
            />
          </aside>
        )}

        {/* Help overlay. Hidden by default; toggled by ? button or shortcut. */}
        {helpOpen && (
          <div
            role="dialog"
            aria-modal="false"
            className="absolute bottom-5 left-5 z-10 w-[22rem]"
          >
            <Panel
              title="Console legend"
              subtitle="What you're looking at"
              accent={
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="inline-flex items-center border border-[color:var(--color-rule)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)] transition hover:text-[color:var(--color-ink)]"
                >
                  esc
                </button>
              }
            >
              <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-[11px]">
                <dt className="text-[color:var(--color-ink-faint)]">each star</dt>
                <dd className="text-[color:var(--color-ink-dim)]">
                  one memory, projected from 384 dimensions into 3D
                </dd>
                <dt className="text-[color:var(--color-ink-faint)]">size</dt>
                <dd className="text-[color:var(--color-ink-dim)]">
                  how useful it is right now (semantic match × access count ÷ age)
                </dd>
                <dt className="text-[color:var(--color-ink-faint)]">colour</dt>
                <dd className="text-[color:var(--color-ink-dim)]">
                  pale → <span className="text-[color:var(--color-accent)]">amber</span>{" "}
                  as utility climbs
                </dd>
                <dt className="text-[color:var(--color-ink-faint)]">search</dt>
                <dd className="text-[color:var(--color-ink-dim)]">
                  embedded on-device — your text never leaves the browser
                </dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-[color:var(--color-rule-soft)] pt-3 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
                <ShortcutHint k="/" label="search" />
                <ShortcutHint k="i" label="ingest" />
                <ShortcutHint k="r" label="clear" />
                <ShortcutHint k="esc" label="back out" />
              </div>
            </Panel>
          </div>
        )}

        {showTooltip && hoveredMemory && hoverPos && (
          <MemoryTooltip
            memory={hoveredMemory}
            utility={tooltipUtility}
            position={hoverPos}
          />
        )}
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
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-mute)]">
        {label}
      </span>
      <span
        className={`num ${
          accent ? "text-[color:var(--color-accent)]" : "text-[color:var(--color-ink)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ShortcutHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="border border-[color:var(--color-rule)] bg-[color:var(--color-panel-strong)] px-1.5 py-0.5 text-[color:var(--color-ink-dim)] normal-case tracking-normal">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}
