import type { HudMemory } from "./types";
import { cosine } from "./embedder";

export interface UtilityParams {
  recencyHalfLifeMs?: number;
  accessFloor?: number;
}

export function utility(
  m: HudMemory,
  goal: Float32Array | null,
  now: number = Date.now(),
  params: UtilityParams = {},
): number {
  const { recencyHalfLifeMs = 24 * 60 * 60 * 1000, accessFloor = 1 } = params;
  const sim = goal ? (cosine(m.embedding, goal) + 1) / 2 : 0.5;
  const c = Math.max(accessFloor, m.accessCount + 1);
  const age = Math.max(1, now - m.lastAccessedAt);
  const t = age / 1000;
  return (sim * c) / t;
}

// Projects a high-dimensional embedding into a stable 3D position by folding
// the vector into three accumulator bins. Cheap enough to run per-frame on
// thousands of points; doesn't preserve semantic neighborhoods as well as PCA,
// but gives a visually meaningful spread with zero JS-side matrix math.
export function project3D(e: Float32Array): [number, number, number] {
  const third = Math.floor(e.length / 3) || 1;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < third; i++) x += e[i] ?? 0;
  for (let i = third; i < 2 * third; i++) y += e[i] ?? 0;
  for (let i = 2 * third; i < e.length; i++) z += e[i] ?? 0;
  return [x, y, z];
}
