/**
 * Phase 11 (D-005) — places market-event annotations on the price chart's
 * time axis: only the ones inside the drawn window, nudged into two lanes
 * so neighbouring labels do not overlap. Pure; rendered by
 * `ChartAnnotations.tsx`.
 */
import type { ChartAnnotation } from "./depth-types.ts";

export interface PlacedAnnotation extends ChartAnnotation {
  /** Pixel x inside the chart's viewBox. */
  x: number;
  /** 0 = top lane, 1 = second lane, for labels that would collide. */
  lane: 0 | 1;
}

/** Labels closer than this (in chart px) alternate lanes. */
export const LANE_GAP_PX = 56;

export function placeAnnotations(
  annotations: readonly ChartAnnotation[],
  t0: number,
  t1: number,
  width: number,
): PlacedAnnotation[] {
  const span = Math.max(1, t1 - t0);
  const inside = annotations.filter((a) => a.t >= t0 && a.t <= t1).sort((a, b) => a.t - b.t);
  const out: PlacedAnnotation[] = [];
  for (const a of inside) {
    const x = ((a.t - t0) / span) * width;
    const prev = out.at(-1);
    const lane: 0 | 1 = prev && x - prev.x < LANE_GAP_PX ? (prev.lane === 0 ? 1 : 0) : 0;
    out.push({ ...a, x, lane });
  }
  return out;
}

/** The chart legend's one-line summary of what is annotated. */
export function annotationSummary(placed: readonly PlacedAnnotation[]): string | null {
  if (placed.length === 0) return null;
  const kinds = new Map<string, number>();
  for (const a of placed) kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
  const words: string[] = [];
  if (kinds.has("kickoff")) words.push("kickoff");
  const periods = kinds.get("period") ?? 0;
  if (periods > 0)
    words.push(periods === 1 ? "1 period change" : `${String(periods)} period changes`);
  const injuries = kinds.get("injury") ?? 0;
  if (injuries > 0)
    words.push(injuries === 1 ? "1 injury report" : `${String(injuries)} injury reports`);
  if (kinds.has("frozen")) words.push("close");
  if (kinds.has("resolved")) words.push("resolution");
  return `Marked: ${words.join(", ")}`;
}
