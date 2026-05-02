"use client";

import { Panel } from "./Panel";
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

const SYNC_LABEL: Record<HudMemory["syncState"], string> = {
  local: "local only",
  syncing: "writing to remote",
  synced: "in sync",
};

export function MemoryInspector({ memory, utility, onClose }: MemoryInspectorProps) {
  const ageMs = Date.now() - memory.lastAccessedAt;

  return (
    <Panel
      strong
      title="Inspecting memory"
      subtitle={memory.id}
      accent={
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="inline-flex items-center border border-[color:var(--color-rule)] bg-[color:var(--color-bg-deep)] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)] transition hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-accent)]/60"
        >
          esc
        </button>
      }
    >
      <p className="text-[13px] leading-relaxed text-[color:var(--color-ink)]">
        {memory.content}
      </p>

      <dl className="mt-4 divide-y divide-[color:var(--color-rule-soft)] border-t border-[color:var(--color-rule-soft)] text-[11px]">
        <Row label="utility" value={utility.toFixed(3)} accent />
        <Row label="importance" value={memory.importance.toFixed(1)} />
        <Row label="access count" value={memory.accessCount.toString()} />
        <Row label="last seen" value={formatAge(ageMs)} />
        <Row label="partition" value={memory.partition} />
        <Row
          label="sync state"
          value={SYNC_LABEL[memory.syncState]}
          tone={
            memory.syncState === "synced"
              ? "up"
              : memory.syncState === "syncing"
                ? "accent"
                : undefined
          }
        />
        <Row label="size" value={`${memory.sizeBytes.toLocaleString()} B`} />
      </dl>
    </Panel>
  );
}

function Row({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tone?: "up" | "accent";
}) {
  const valueColor = accent
    ? "text-[color:var(--color-accent)]"
    : tone === "up"
      ? "text-[color:var(--color-up)]"
      : tone === "accent"
        ? "text-[color:var(--color-accent)]"
        : "text-[color:var(--color-ink-dim)]";
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-[color:var(--color-ink-faint)]">{label}</dt>
      <dd className={`num text-right ${valueColor}`}>{value}</dd>
    </div>
  );
}
