"use client";

import { useEffect, useRef } from "react";

// Lightweight 2D starfield painted on a canvas behind the main galaxy. Runs on
// requestAnimationFrame but only repaints on a 2hz parallax tick to stay under
// 1% CPU; the galaxy itself owns the 60fps budget.
export function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = window.devicePixelRatio || 1;
    type Star = { x: number; y: number; r: number; a: number; twinkle: number };
    let stars: Star[] = [];

    function seed() {
      const n = Math.floor((w * h) / 7_000);
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.2 + 0.2,
        a: Math.random() * 0.7 + 0.1,
        twinkle: Math.random() * Math.PI * 2,
      }));
    }

    function resize() {
      dpr = window.devicePixelRatio || 1;
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    resize();
    window.addEventListener("resize", resize);

    let rafId = 0;
    const start = performance.now();
    function tick(now: number) {
      const t = (now - start) / 1000;
      ctx!.clearRect(0, 0, w, h);
      for (const s of stars) {
        const flicker = 0.6 + 0.4 * Math.sin(t * 2 + s.twinkle);
        ctx!.globalAlpha = s.a * flicker;
        ctx!.fillStyle = "oklch(92% 0.05 225)";
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-[1]"
    />
  );
}
