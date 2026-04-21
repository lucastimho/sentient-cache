import type { Memory, UtilityScored } from "../types";
import { cosine } from "./similarity";

export interface UtilityParams {
  similarityFloor?: number;
  countFloor?: number;
  ageFloorMs?: number;
}

export function utilityScore(
  mem: Memory,
  goal: Float32Array | null,
  now: number,
  params: UtilityParams = {},
): number {
  const { similarityFloor = 0.01, countFloor = 1, ageFloorMs = 1_000 } = params;
  const s = goal ? Math.max(similarityFloor, (cosine(mem.embedding, goal) + 1) / 2) : similarityFloor;
  const c = Math.max(countFloor, mem.accessCount + 1);
  const ageMs = Math.max(ageFloorMs, now - mem.lastAccessedAt);
  const t = ageMs / 1000;
  return (s * c) / t;
}

export function rankForEviction(
  rows: Memory[],
  goal: Float32Array | null,
  now: number,
  params?: UtilityParams,
): UtilityScored[] {
  const scored = rows.map<UtilityScored>((m) => ({
    id: m.id,
    sizeBytes: m.sizeBytes,
    utility: utilityScore(m, goal, now, params),
  }));
  scored.sort((a, b) => a.utility - b.utility);
  return scored;
}
