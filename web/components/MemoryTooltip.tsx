"use client";

import type { HudMemory } from "@/lib/types";

interface MemoryTooltipProps {
  memory: HudMemory;
  utility: number;
  position: { x: number; y: number };
}

const OFFSET_X = 16;
const OFFSET_Y = 16;
const MAX_WIDTH = 288;

export function MemoryTooltip({ memory, utility, position }: MemoryTooltipProps) {
  // Flip the tooltip to the cursor's left when too close to the right edge so
  // it never escapes the viewport on small screens.
  const flipLeft =
    typeof window !== "undefined" && position.x + OFFSET_X + MAX_WIDTH > window.innerWidth;
  const left = flipLeft ? position.x - OFFSET_X - MAX_WIDTH : position.x + OFFSET_X;

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-72 rounded-md border border-[color:var(--color-glass-edge)] bg-[color:var(--color-glass-bg-strong)] px-3 py-2 mono text-[11px] text-[color:var(--color-ink)] shadow-[0_18px_40px_-18px_oklch(0_0_0/0.7)] backdrop-blur-md"
      style={{ left, top: position.y + OFFSET_Y }}
    >
      <div className="text-[color:var(--color-accent)] glow-text truncate">{memory.id}</div>
      <div className="mt-1 line-clamp-2 text-[color:var(--color-ink-dim)]">{memory.content}</div>
      <div className="mt-1.5 flex gap-3 text-[10px] uppercase tracking-widest text-[color:var(--color-ink-faint)]">
        <span>U {utility.toFixed(2)}</span>
        <span>I {memory.importance.toFixed(1)}</span>
        <span>{memory.partition}</span>
      </div>
    </div>
  );
}
