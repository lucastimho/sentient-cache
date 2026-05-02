"use client";

import type { HudMemory } from "@/lib/types";

interface MemoryTooltipProps {
  memory: HudMemory;
  utility: number;
  position: { x: number; y: number };
}

const OFFSET_X = 14;
const OFFSET_Y = 14;
const MAX_WIDTH = 288;
const APPROX_HEIGHT = 78;
const MARGIN = 8;

export function MemoryTooltip({ memory, utility, position }: MemoryTooltipProps) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  const flipLeft = position.x + OFFSET_X + MAX_WIDTH > vw - MARGIN;
  const flipUp = position.y + OFFSET_Y + APPROX_HEIGHT > vh - MARGIN;

  const left = flipLeft
    ? Math.max(MARGIN, position.x - OFFSET_X - MAX_WIDTH)
    : position.x + OFFSET_X;
  const top = flipUp
    ? Math.max(MARGIN, position.y - OFFSET_Y - APPROX_HEIGHT)
    : position.y + OFFSET_Y;

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-72 border border-[color:var(--color-rule)] bg-[color:var(--color-panel-strong)] px-3 py-2 text-[11px] text-[color:var(--color-ink)]"
      style={{ left, top }}
    >
      <div className="text-[color:var(--color-accent)] truncate num">{memory.id}</div>
      <div className="mt-1 line-clamp-2 text-[color:var(--color-ink-dim)]">
        {memory.content}
      </div>
      <div className="mt-1.5 flex gap-3 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
        <span className="num normal-case tracking-normal">
          utility {utility.toFixed(2)}
        </span>
        <span className="text-[color:var(--color-rule)]">|</span>
        <span className="num normal-case tracking-normal">
          importance {memory.importance.toFixed(1)}
        </span>
        <span className="text-[color:var(--color-rule)]">|</span>
        <span>{memory.partition}</span>
      </div>
    </div>
  );
}
