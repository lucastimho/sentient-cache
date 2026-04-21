"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { HudMemory } from "@/lib/types";
import { project3D, utility } from "@/lib/utility";

const VERTEX_SHADER = /* glsl */ `
  attribute float size;
  attribute float highlighted;
  varying vec3 vColor;
  varying float vHighlight;
  uniform float uPixelRatio;
  uniform float uTime;

  void main() {
    vColor = color;
    vHighlight = highlighted;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 1.0 + 0.15 * sin(uTime * 2.0 + position.x * 0.4);
    gl_PointSize = size * pulse * uPixelRatio * (240.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vHighlight;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    float core = smoothstep(0.5, 0.0, d);
    float halo = exp(-d * 6.5);
    vec3 base = mix(vColor, vec3(1.0), vHighlight * 0.75);
    float alpha = halo * (0.6 + vHighlight * 0.4);
    gl_FragColor = vec4(base * (0.4 + core), alpha);
  }
`;

export interface MemoryGalaxyProps {
  memories: HudMemory[];
  highlighted: Set<string>;
  goal: Float32Array | null;
  className?: string;
}

interface Internals {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  resize: () => void;
}

export function MemoryGalaxy({
  memories,
  highlighted,
  goal,
  className,
}: MemoryGalaxyProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const internalsRef = useRef<Internals | null>(null);

  const count = memories.length;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const w = mount.clientWidth;
    const h = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050a18, 0.02);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
    camera.position.set(0, 0, 18);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.className = "block h-full w-full";

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(new Float32Array(0), 1));
    geometry.setAttribute("highlighted", new THREE.BufferAttribute(new Float32Array(0), 1));

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

    const resize = () => {
      const cw = mount.clientWidth;
      const ch = mount.clientHeight;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch, false);
      material.uniforms.uPixelRatio!.value = renderer.getPixelRatio();
    };
    window.addEventListener("resize", resize);

    internalsRef.current = { scene, camera, renderer, points, geometry, material, resize };

    const start = performance.now();
    let rafId = 0;
    const animate = (now: number) => {
      const t = (now - start) / 1000;
      material.uniforms.uTime!.value = t;
      points.rotation.y = t * 0.04;
      points.rotation.x = Math.sin(t * 0.07) * 0.12;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
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

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const highlights = new Float32Array(count);

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

      const hi = highlighted.has(m.id) ? 1 : 0;
      highlights[i] = hi;

      const baseR = 0.45 + u * 0.35;
      const baseG = 0.72 + u * 0.2;
      const baseB = 0.95;
      colors[i * 3] = baseR;
      colors[i * 3 + 1] = baseG;
      colors[i * 3 + 2] = baseB;
    }

    const geom = internals.geometry;
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute("highlighted", new THREE.BufferAttribute(highlights, 1));
    geom.computeBoundingSphere();
  }, [memories, highlighted, goal, count]);

  const stats = useMemo(() => {
    const synced = memories.filter((m) => m.syncState === "synced").length;
    const syncing = memories.filter((m) => m.syncState === "syncing").length;
    return { total: memories.length, synced, syncing, highlighted: highlighted.size };
  }, [memories, highlighted]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={mountRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-4 top-4 mono text-[11px] tracking-wider uppercase text-[color:var(--color-ink-faint)] space-y-0.5">
        <div>
          nodes{" "}
          <span className="text-[color:var(--color-ink-dim)] glow-text">
            {stats.total.toLocaleString()}
          </span>
        </div>
        <div>
          highlighted{" "}
          <span className="text-[color:var(--color-accent)] glow-text">
            {stats.highlighted}
          </span>
        </div>
        <div>
          syncing{" "}
          <span className="text-[color:var(--color-star-dim)] glow-text">
            {stats.syncing}
          </span>
        </div>
      </div>
    </div>
  );
}
