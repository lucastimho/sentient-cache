"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "./GlassPanel";
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

      ctx.strokeStyle = "oklch(78% 0.16 225 / 85%)";
      ctx.lineWidth = 1.6;
      ctx.shadowColor = "oklch(78% 0.16 225 / 50%)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      for (let i = 0; i < recent.length; i++) {
        const x = (i / (MAX_SAMPLES - 1)) * w;
        const v = recent[i]!.edgeMs;
        const y = h - ((v - min) / (max - min)) * h * 0.9 - 4;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "oklch(78% 0.16 225 / 18%)";
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();

      // Target line at 10ms
      ctx.strokeStyle = "oklch(72% 0.18 150 / 60%)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const targetY = h - ((10 - min) / (max - min)) * h * 0.9 - 4;
      ctx.moveTo(0, targetY);
      ctx.lineTo(w, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [samples]);

  return <canvas ref={canvasRef} className="h-20 w-full" />;
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
  const refs = [...LATENCY_REFERENCES, { label: "Edge retrieval", ns: edgeNs }];
  const maxLog = Math.log10(Math.max(...refs.map((r) => Math.max(1, r.ns))));

  return (
    <GlassPanel
      title="Latency Vitals"
      subtitle="L1 → Edge reference chain"
      accent={
        <div className="mono text-right leading-tight">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-ink-faint)]">
            current
          </div>
          <div className="text-lg font-semibold text-[color:var(--color-accent)] glow-text">
            {currentMs == null ? "—" : `${currentMs.toFixed(2)} ms`}
          </div>
          {p50 !== null && (
            <div className="text-[10px] text-[color:var(--color-ink-faint)]">
              p50 {p50.toFixed(2)} ms
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-2">
        {refs.map((ref) => {
          const logV = Math.log10(Math.max(1, ref.ns));
          const pct = (logV / maxLog) * 100;
          const isEdge = ref.label === "Edge retrieval";
          const bar = isEdge
            ? "bg-gradient-to-r from-[color:var(--color-accent)] to-[color:var(--color-star-core)]"
            : "bg-[color:var(--color-accent-dim)]/50";
          return (
            <div key={ref.label} className="flex items-center gap-3">
              <div className="w-28 shrink-0 text-[11px] tracking-wide text-[color:var(--color-ink-dim)]">
                {ref.label}
              </div>
              <div className="relative h-1.5 flex-1 rounded-full bg-[color:var(--color-glass-edge)]/40 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${bar}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div
                className={`w-24 shrink-0 mono text-right text-[11px] ${
                  isEdge
                    ? "text-[color:var(--color-accent)] glow-text"
                    : "text-[color:var(--color-ink-faint)]"
                }`}
              >
                {ref.ns === 0 ? "—" : formatNs(ref.ns)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 border-t border-[color:var(--color-glass-edge)]/60 pt-3">
        <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-[color:var(--color-ink-faint)]">
          <span>last {Math.min(samples.length, MAX_SAMPLES)} reads</span>
          <span className="text-[color:var(--color-success)]">SLO: 10 ms</span>
        </div>
        <Sparkline samples={samples} />
      </div>
    </GlassPanel>
  );
}
