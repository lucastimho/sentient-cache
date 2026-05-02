"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { HudMemory } from "@/lib/types";
import { project3D, utility } from "@/lib/utility";

const VERTEX_SHADER = /* glsl */ `
  attribute float size;
  attribute float highlighted;
  attribute float selected;
  varying vec3 vColor;
  varying float vHighlight;
  varying float vSelected;
  uniform float uPixelRatio;
  uniform float uTime;

  void main() {
    vColor = color;
    vHighlight = highlighted;
    vSelected = selected;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + 0.06 * sin(uTime * 1.4 + position.x * 0.4);
    float selectedBoost = 1.0 + selected * 1.5;
    gl_PointSize = size * pulse * selectedBoost * uPixelRatio * (240.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vHighlight;
  varying float vSelected;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float halo = exp(-d * 6.5);

    vec3 base = mix(vColor, vec3(0.99, 0.92, 0.78), vHighlight * 0.85);
    base = mix(base, vec3(1.0, 0.86, 0.45), vSelected);

    float ring = vSelected * smoothstep(0.40, 0.34, d) * smoothstep(0.26, 0.32, d);

    float alpha = halo * (0.6 + vHighlight * 0.4 + vSelected * 0.6) + ring * 0.85;
    gl_FragColor = vec4(base * (0.4 + core), alpha);
  }
`;

export interface MemoryGalaxyProps {
  memories: HudMemory[];
  highlighted: Set<string>;
  goal: Float32Array | null;
  selectedId: string | null;
  onHover: (memory: HudMemory | null, screen: { x: number; y: number } | null) => void;
  onSelect: (memory: HudMemory | null) => void;
  className?: string;
}

interface Internals {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  raycaster: THREE.Raycaster;
}

const IDLE_BEFORE_AUTO_ROTATE_MS = 4000;
const CLICK_THRESHOLD_PX = 5;

export function MemoryGalaxy({
  memories,
  highlighted,
  goal,
  selectedId,
  onHover,
  onSelect,
  className,
}: MemoryGalaxyProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const internalsRef = useRef<Internals | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Latest props mirrored into refs so the long-lived input handlers and RAF
  // loop see fresh values without re-mounting the WebGL context.
  const memoriesRef = useRef(memories);
  const onHoverRef = useRef(onHover);
  const onSelectRef = useRef(onSelect);
  memoriesRef.current = memories;
  onHoverRef.current = onHover;
  onSelectRef.current = onSelect;

  const lastInteractAtRef = useRef(performance.now());
  const userRotationRef = useRef({ x: 0, y: 0 });
  const dragStateRef = useRef<{ active: boolean; lastX: number; lastY: number; downX: number; downY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
    downX: 0,
    downY: 0,
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth;
    const h = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0c0a08, 0.022);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
    camera.position.set(0, 0, 18);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch (err) {
      setWebglError(
        err instanceof Error ? err.message : "WebGL context unavailable",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.className = "block h-full w-full cursor-grab touch-none";

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError("WebGL context lost — reload the page to restore the galaxy.");
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(new Float32Array(0), 1));
    geometry.setAttribute("highlighted", new THREE.BufferAttribute(new Float32Array(0), 1));
    geometry.setAttribute("selected", new THREE.BufferAttribute(new Float32Array(0), 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: renderer.getPixelRatio() },
        uTime: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const raycaster = new THREE.Raycaster();
    if (raycaster.params.Points) {
      raycaster.params.Points.threshold = 0.5;
    }

    internalsRef.current = { scene, camera, renderer, points, geometry, material, raycaster };

    const ndc = new THREE.Vector2();
    let lastHoveredId: string | null = null;

    const pickAt = (clientX: number, clientY: number): HudMemory | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(points, false);
      if (hits.length === 0) return null;
      const idx = hits[0]!.index;
      if (idx == null) return null;
      return memoriesRef.current[idx] ?? null;
    };

    const handlePointerMove = (e: PointerEvent) => {
      lastInteractAtRef.current = performance.now();
      const drag = dragStateRef.current;

      if (drag.active) {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        userRotationRef.current.y += dx * 0.005;
        userRotationRef.current.x += dy * 0.005;
        userRotationRef.current.x = Math.max(-1.2, Math.min(1.2, userRotationRef.current.x));
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (lastHoveredId !== null) {
          lastHoveredId = null;
          onHoverRef.current(null, null);
        }
        return;
      }

      const mem = pickAt(e.clientX, e.clientY);
      if (mem) {
        lastHoveredId = mem.id;
        onHoverRef.current(mem, { x: e.clientX, y: e.clientY });
      } else if (lastHoveredId !== null) {
        lastHoveredId = null;
        onHoverRef.current(null, null);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      dragStateRef.current = {
        active: true,
        lastX: e.clientX,
        lastY: e.clientY,
        downX: e.clientX,
        downY: e.clientY,
      };
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture(e.pointerId);
      lastInteractAtRef.current = performance.now();
    };

    const handlePointerUp = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      const moved =
        Math.abs(e.clientX - drag.downX) > CLICK_THRESHOLD_PX ||
        Math.abs(e.clientY - drag.downY) > CLICK_THRESHOLD_PX;
      drag.active = false;
      renderer.domElement.style.cursor = "grab";
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer was already released */
      }
      if (moved) return;
      const mem = pickAt(e.clientX, e.clientY);
      onSelectRef.current(mem);
    };

    const handlePointerLeave = () => {
      if (lastHoveredId !== null) {
        lastHoveredId = null;
        onHoverRef.current(null, null);
      }
      dragStateRef.current.active = false;
      renderer.domElement.style.cursor = "grab";
    };

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);

    const resize = () => {
      const cw = mount.clientWidth;
      const ch = mount.clientHeight;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch, false);
      material.uniforms.uPixelRatio!.value = renderer.getPixelRatio();
    };
    window.addEventListener("resize", resize);

    const start = performance.now();
    let rafId = 0;
    const animate = (now: number) => {
      const t = (now - start) / 1000;
      material.uniforms.uTime!.value = t;

      const idle = now - lastInteractAtRef.current > IDLE_BEFORE_AUTO_ROTATE_MS;
      if (idle && !dragStateRef.current.active) {
        userRotationRef.current.y += 0.0008;
      }

      points.rotation.y = userRotationRef.current.y;
      points.rotation.x = userRotationRef.current.x + Math.sin(t * 0.05) * 0.04;

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("webglcontextlost", handleContextLost);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
      internalsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const internals = internalsRef.current;
    if (!internals) return;
    const count = memories.length;

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const highlights = new Float32Array(count);
    const selected = new Float32Array(count);

    const now = Date.now();
    let maxU = 0;
    const scores = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = utility(memories[i]!, goal, now);
      scores[i] = u;
      if (u > maxU) maxU = u;
    }
    const norm = maxU > 0 ? maxU : 1;

    for (let i = 0; i < count; i++) {
      const m = memories[i]!;
      const [x, y, z] = project3D(m.embedding);
      positions[i * 3] = x * 3.2;
      positions[i * 3 + 1] = y * 3.2;
      positions[i * 3 + 2] = z * 3.2;

      const u = scores[i]! / norm;
      sizes[i] = 1.5 + u * 10 + m.importance * 1.5;
      highlights[i] = highlighted.has(m.id) ? 1 : 0;
      selected[i] = m.id === selectedId ? 1 : 0;

      // Lerp pale warm white → saturated amber as utility climbs.
      const t = u;
      const baseR = 0.96 * (1 - t) + 0.99 * t;
      const baseG = 0.90 * (1 - t) + 0.74 * t;
      const baseB = 0.78 * (1 - t) + 0.30 * t;
      colors[i * 3] = baseR;
      colors[i * 3 + 1] = baseG;
      colors[i * 3 + 2] = baseB;
    }

    const geom = internals.geometry;
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute("highlighted", new THREE.BufferAttribute(highlights, 1));
    geom.setAttribute("selected", new THREE.BufferAttribute(selected, 1));
    geom.computeBoundingSphere();
  }, [memories, highlighted, goal, selectedId]);

  const stats = useMemo(() => {
    const synced = memories.filter((m) => m.syncState === "synced").length;
    const syncing = memories.filter((m) => m.syncState === "syncing").length;
    return { total: memories.length, synced, syncing, highlighted: highlighted.size };
  }, [memories, highlighted]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={mountRef} className="absolute inset-0" />

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="max-w-md border border-[color:var(--color-rule)] bg-[color:var(--color-panel-strong)] px-5 py-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-down)] mb-1.5">
              Galaxy unavailable
            </div>
            <p className="text-[12px] leading-relaxed text-[color:var(--color-ink-dim)]">
              {webglError}
            </p>
            <p className="mt-2 text-[11px] text-[color:var(--color-ink-faint)]">
              Search and ingest still work in the side panel.
            </p>
          </div>
        </div>
      )}

      {!webglError && (
        <>
          <div className="pointer-events-none absolute left-4 top-4 text-[11px] tracking-wide uppercase text-[color:var(--color-ink-faint)] space-y-1">
            <Stat label="nodes" value={stats.total.toLocaleString()} />
            <Stat label="matched" value={stats.highlighted.toString()} accent />
            <Stat label="in-flight" value={stats.syncing.toString()} />
          </div>
          <div className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-faint)]">
            <span>drag to rotate</span>
            <span className="text-[color:var(--color-rule)]">|</span>
            <span>click a star to inspect</span>
            <span className="text-[color:var(--color-rule)]">|</span>
            <span>esc to deselect</span>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[4.5rem] text-[color:var(--color-ink-mute)]">{label}</span>
      <span
        className={`num text-[12px] tracking-normal normal-case ${
          accent ? "text-[color:var(--color-accent)]" : "text-[color:var(--color-ink)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
