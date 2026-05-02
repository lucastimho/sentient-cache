"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "./Panel";
import { LATENCY_REFERENCES, type LatencySample } from "@/lib/types";

const MAX_SAMPLES = 120;

interface LatencyVitalsPanelProps {
  samples: LatencySample[];
  currentMs: number | null;
}

function formatNs(ns: number): string {
  if (ns < 1_000) return `${ns.toFixed(0)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(1)} µs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function Sparkline({ samples }: { samples: LatencySample[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    value: number;
    source: LatencySample["source"];
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, w, h);

      if (samples.length < 2) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const recent = samples.slice(-MAX_SAMPLES);
      const values = recent.map((s) => s.edgeMs);
      const max = Math.max(10, ...values);
      const min = Math.max(0, Math.min(...values) - 0.5);

      // Single hairline stroke. No drop-shadow glow.
      ctx.strokeStyle = "oklch(80% 0.155 78)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < recent.length; i++) {
        const x = (i / (MAX_SAMPLES - 1)) * w;
        const v = recent[i]!.edgeMs;
        const y = h - ((v - min) / (max - min)) * h * 0.85 - 6;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Faint amber fill underneath.
      ctx.fillStyle = "oklch(80% 0.155 78 / 9%)";
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();

      // SLO target line at 10ms.
      ctx.strokeStyle = "oklch(72% 0.12 145 / 45%)";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const targetY = h - ((10 - min) / (max - min)) * h * 0.85 - 6;
      ctx.moveTo(0, targetY);
      ctx.lineTo(w, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [samples]);

  if (samples.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-mute)]">
        awaiting first read
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <canvas
        ref={canvasRef}
        className="h-20 w-full cursor-crosshair"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const recent = samples.slice(-MAX_SAMPLES);
          if (recent.length === 0) return;
          const idx = Math.min(
            recent.length - 1,
            Math.max(0, Math.floor((x / rect.width) * recent.length)),
          );
          const sample = recent[idx]!;
          setHover({ x, y, value: sample.edgeMs, source: sample.source });
        }}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="pointer-events-none absolute text-[10px] tracking-[0.06em] text-[color:var(--color-accent)] whitespace-nowrap num"
          style={{
            // Clamp inside the panel: 4px from the top, flip to right of cursor near the left edge.
            left: Math.min(Math.max(hover.x, 4), 9999),
            top: Math.max(0, hover.y - 18),
            transform: "translate(-50%, 0)",
          }}
        >
          {hover.value.toFixed(2)} ms · {hover.source}
        </div>
      )}
    </div>
  );
}

export function LatencyVitalsPanel({ samples, currentMs }: LatencyVitalsPanelProps) {
  const [bins, setBins] = useState<number[]>([]);

  useEffect(() => {
    if (samples.length === 0) return;
    const recent = samples.slice(-20).map((s) => s.edgeMs);
    setBins(recent);
  }, [samples]);

  const p50 = useMemo(() => {
    if (bins.length === 0) return null;
    const sorted = [...bins].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }, [bins]);

  const edgeNs = currentMs == null ? 0 : currentMs * 1_000_000;
  const refs = [...LATENCY_REFERENCES, { label: "This cache", ns: edgeNs }];
  const maxLog = Math.log10(Math.max(...refs.map((r) => Math.max(1, r.ns))));

  return (
    <Panel
      title="Read latency"
      subtitle="How fast we serve, vs CPU cache, RAM, SSD, network"
      accent={
        <div className="text-right leading-tight">
          <div className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-mute)]">
            current
          </div>
          <div className="num text-[18px] font-medium text-[color:var(--color-accent)]">
            {currentMs == null ? "—" : `${currentMs.toFixed(2)} ms`}
          </div>
          {p50 !== null && (
            <div className="num text-[10px] text-[color:var(--color-ink-faint)]">
              p50 {p50.toFixed(2)} ms
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-1.5">
        {refs.map((ref) => {
          const logV = Math.log10(Math.max(1, ref.ns));
          const pct = (logV / maxLog) * 100;
          const isEdge = ref.label === "This cache";
          return (
            <div key={ref.label} className="flex items-center gap-3">
              <div
                className={`w-28 shrink-0 text-[11px] tracking-tight ${
                  isEdge ? "text-[color:var(--color-ink)]" : "text-[color:var(--color-ink-faint)]"
                }`}
              >
                {ref.label}
              </div>
              <div className="relative h-[3px] flex-1 bg-[color:var(--color-rule-soft)]">
                <div
                  className={`absolute inset-y-0 left-0 ${
                    isEdge
                      ? "bg-[color:var(--color-accent)]"
                      : "bg-[color:var(--color-ink-mute)]"
                  }`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div
                className={`w-24 shrink-0 num text-right text-[11px] ${
                  isEdge
                    ? "text-[color:var(--color-accent)]"
                    : "text-[color:var(--color-ink-faint)]"
                }`}
              >
                {ref.ns === 0 ? "—" : formatNs(ref.ns)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 border-t border-[color:var(--color-rule-soft)] pt-3">
        <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
          <span>last {Math.min(samples.length, MAX_SAMPLES)} reads</span>
          <span className="text-[color:var(--color-up)]">target 10 ms</span>
        </div>
        <Sparkline samples={samples} />
      </div>
    </Panel>
  );
}
