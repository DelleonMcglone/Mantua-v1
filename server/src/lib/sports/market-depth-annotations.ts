/**
 * Phase 11 (D-005) — the events a price chart is annotated with, from the
 * data the layer actually carries: kickoff, period starts (the first
 * ingested play of each period), the freeze and the resolution, and injury
 * reports for either team. Nothing is estimated: a halftime with no play
 * ingested is not drawn.
 */
import type { DepthEvent, DepthMarket, InjuryRow } from "./market-depth-read.ts";

export type AnnotationKind = "kickoff" | "period" | "frozen" | "resolved" | "injury";

export interface ChartAnnotation {
  t: number;
  kind: AnnotationKind;
  label: string;
}

/** Leagues played in four quarters, where period 3 opens the second half. */
const QUARTER_LEAGUES = new Set(["nfl", "wnba", "nba"]);
export const MAX_INJURY_ANNOTATIONS = 6;

/** "Q2", "2nd half", "OT" for quarter leagues; "Period 2" otherwise. */
export function periodLabel(league: string | null, period: number): string {
  if (league !== null && QUARTER_LEAGUES.has(league)) {
    if (period === 3) return "2nd half";
    if (period > 4) return period === 5 ? "OT" : `OT${String(period - 4)}`;
    return `Q${String(period)}`;
  }
  return `Period ${String(period)}`;
}

function injuryLabel(event: DepthEvent, i: InjuryRow): string {
  const side = i.teamId === event.home.teamId ? event.home : event.away;
  const who = i.player ?? "Player";
  const tag = side.abbreviation ?? side.key ?? "";
  return `${tag ? `${tag}: ` : ""}${who} ${i.status.replace(/_/g, " ")}`;
}

export function annotationsFor(input: {
  event: DepthEvent;
  market: DepthMarket | null;
  periods: { period: number; at: number }[];
  injuries: InjuryRow[];
  nowSec: number;
}): ChartAnnotation[] {
  const { event, market, periods, injuries, nowSec } = input;
  const out: ChartAnnotation[] = [];
  if (event.startsAt <= nowSec) out.push({ t: event.startsAt, kind: "kickoff", label: "Kickoff" });
  for (const p of [...periods].sort((a, b) => a.period - b.period)) {
    if (p.period <= 1) continue;
    out.push({ t: p.at, kind: "period", label: periodLabel(event.league, p.period) });
  }
  if (market?.frozenAt !== null && market?.frozenAt !== undefined)
    out.push({ t: market.frozenAt, kind: "frozen", label: "Trading closed" });
  if (market?.resolvedAt !== null && market?.resolvedAt !== undefined)
    out.push({ t: market.resolvedAt, kind: "resolved", label: "Resolved" });
  for (const i of [...injuries].sort((a, b) => b.at - a.at).slice(0, MAX_INJURY_ANNOTATIONS)) {
    out.push({ t: i.at, kind: "injury", label: injuryLabel(event, i) });
  }
  return out.sort((a, b) => a.t - b.t);
}
