"use client";

import { GlassPanel } from "./GlassPanel";
import type { HudMemory } from "@/lib/types";

interface MemoryInspectorProps {
  memory: HudMemory;
  utility: number;
  onClose: () => void;
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function MemoryInspector({ memory, utility, onClose }: MemoryInspectorProps) {
  const ageMs = Date.now() - memory.lastAccessedAt;

  return (
    <GlassPanel
      strong
      title="Inspecting Memory"
      subtitle={memory.id}
      accent={
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="inline-flex items-center gap-1.5 rounded border border-[color:var(--color-glass-edge)] bg-[color:var(--color-nebula-deep)]/60 px-1.5 py-0.5 mono text-[10px] uppercase tracking-widest text-[color:var(--color-ink-faint)] transition hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-accent)]/50"
        >
          esc
        </button>
      }
    >
      <p className="text-sm leading-relaxed text-[color:var(--color-ink)]">
        {memory.content}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 mono text-[11px]">
        <dt className="text-[color:var(--color-ink-faint)]">utility</dt>
        <dd className="text-right text-[color:var(--color-accent)] glow-text">
          {utility.toFixed(3)}
        </dd>
        <dt className="text-[color:var(--color-ink-faint)]">importance</dt>
        <dd className="text-right text-[color:var(--color-ink-dim)]">
          {memory.importance.toFixed(1)}
        </dd>
        <dt className="text-[color:var(--color-ink-faint)]">access count</dt>
        <dd className="text-right text-[color:var(--color-ink-dim)]">
          {memory.accessCount}
        </dd>
        <dt className="text-[color:var(--color-ink-faint)]">last seen</dt>
        <dd className="text-right text-[color:var(--color-ink-dim)]">{formatAge(ageMs)}</dd>
        <dt className="text-[color:var(--color-ink-faint)]">partition</dt>
        <dd className="text-right text-[color:var(--color-ink-dim)]">
          {memory.partition}
        </dd>
        <dt className="text-[color:var(--color-ink-faint)]">sync state</dt>
        <dd
          className={`text-right ${
            memory.syncState === "synced"
              ? "text-[color:var(--color-success)]"
              : "text-[color:var(--color-accent)] pulse-glow"
          }`}
        >
          {memory.syncState}
        </dd>
        <dt className="text-[color:var(--color-ink-faint)]">size</dt>
        <dd className="text-right text-[color:var(--color-ink-dim)]">
          {memory.sizeBytes.toLocaleString()} B
        </dd>
      </dl>
    </GlassPanel>
  );
}
