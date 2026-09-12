/**
 * Phase 8 / A-004, A-005, A-022 — `sports_intelligence`: the pure estimator
 * behind `mantua_analyze_market`. Given what the canonical database knows
 * about a game (records, form, injuries, head-to-head, live score) it
 * produces a transparent win probability for one side, lists every piece
 * of evidence with its weight, names the risk factors, and compares the
 * estimate with the market's implied probability.
 *
 * Deliberately simple and fully explained: each component is a bounded
 * additive adjustment on a home-advantage baseline, so the model (and the
 * user) can see exactly why the number is what it is. It is a reasoning
 * aid, not a prediction engine; the disclaimers say so and the suggested
 * action always routes through the simulation and the user's confirm.
 */

export interface SideFacts {
  name: string;
  /** Season record from standings (null when none ingested). */
  record: { wins: number; losses: number; ties: number } | null;
  /** Results of recent finished games, newest first. */
  recentForm: ("W" | "L" | "T")[];
  /** Open injuries: status strings as the provider reports them. */
  injuries: { status: string; player: string | null; position: string | null }[];
}

export interface AnalysisFacts {
  league: string | null;
  /** The side being analyzed. */
  side: "home" | "away";
  team: SideFacts;
  opponent: SideFacts;
  /** Head-to-head wins over recent meetings, from the team's perspective. */
  headToHead: { teamWins: number; opponentWins: number; ties: number } | null;
  /** In-play score from the team's perspective, when the game is live. */
  live: { teamScore: number; opponentScore: number } | null;
  gameStatus: string;
  /** Market's implied probability for the team's YES, bps; null when unpriced. */
  marketImpliedBps: number | null;
  /** Age of that price capture in seconds (null when unpriced). */
  marketAgeSeconds: number | null;
  liquidityUsdc: number | null;
  /** Slate served from a delayed copy. */
  delayed: boolean;
}

export interface EvidenceItem {
  factor: string;
  detail: string;
  /** Adjustment in bps applied to the team's win probability. */
  effectBps: number;
}

export interface SportsAnalysis {
  probabilityBps: number;
  method: string;
  evidence: EvidenceItem[];
  riskFactors: string[];
  /** model − market, bps; null when the market is unpriced. */
  discrepancyBps: number | null;
  confidence: "low" | "medium" | "high";
  suggestedAction: {
    kind: "consider_buy_yes" | "consider_fade" | "hold" | "no_market_price";
    rationale: string;
  };
  disclaimers: string[];
}

const HOME_ADVANTAGE_BPS: Record<string, number> = { nfl: 250, wnba: 300 };
const DEFAULT_HOME_ADVANTAGE_BPS = 250;
/** Edge the estimate must show over the market before suggesting a side. */
export const EDGE_THRESHOLD_BPS = 500;

function winPct(r: { wins: number; losses: number; ties: number } | null): number | null {
  if (!r) return null;
  const games = r.wins + r.losses + r.ties;
  if (games === 0) return null;
  return (r.wins + r.ties / 2) / games;
}

function formPct(form: readonly ("W" | "L" | "T")[]): number | null {
  if (form.length === 0) return null;
  const pts = form.reduce((acc, r) => acc + (r === "W" ? 1 : r === "T" ? 0.5 : 0), 0);
  return pts / form.length;
}

function injuryPenaltyBps(injuries: SideFacts["injuries"]): number {
  let bps = 0;
  for (const i of injuries) {
    const s = i.status.toLowerCase();
    if (s.includes("out") || s.includes("ir") || s.includes("doubtful")) bps += 300;
    else if (s.includes("questionable") || s.includes("day-to-day") || s.includes("probable"))
      bps += 100;
  }
  return Math.min(bps, 900);
}

function clamp(bps: number, lo = 500, hi = 9500): number {
  return Math.max(lo, Math.min(hi, Math.round(bps)));
}

/** Pure: the estimate, its evidence, risks and the market comparison. */
export function analyzeSide(f: AnalysisFacts): SportsAnalysis {
  const evidence: EvidenceItem[] = [];
  const risks: string[] = [];
  let bps = 5000;

  // 1. Venue.
  const home = HOME_ADVANTAGE_BPS[f.league ?? ""] ?? DEFAULT_HOME_ADVANTAGE_BPS;
  const venue = f.side === "home" ? home : -home;
  bps += venue;
  evidence.push({
    factor: "venue",
    detail: `${f.team.name} ${f.side === "home" ? "at home" : "on the road"}`,
    effectBps: venue,
  });

  // 2. Season strength from standings.
  const a = winPct(f.team.record);
  const b = winPct(f.opponent.record);
  if (a !== null && b !== null) {
    const eff = Math.round((a - b) * 5000);
    bps += eff;
    evidence.push({
      factor: "season record",
      detail: `${f.team.name} ${String(f.team.record?.wins)}-${String(f.team.record?.losses)} vs ${f.opponent.name} ${String(f.opponent.record?.wins)}-${String(f.opponent.record?.losses)}`,
      effectBps: eff,
    });
  } else {
    risks.push("no season record for one or both teams — strength unweighted");
  }

  // 3. Recent form.
  const fa = formPct(f.team.recentForm);
  const fb = formPct(f.opponent.recentForm);
  if (fa !== null && fb !== null) {
    const eff = Math.round((fa - fb) * 2000);
    bps += eff;
    evidence.push({
      factor: "recent form",
      detail: `${f.team.name} ${f.team.recentForm.join("")} vs ${f.opponent.name} ${f.opponent.recentForm.join("")}`,
      effectBps: eff,
    });
    if (f.team.recentForm.length < 3 || f.opponent.recentForm.length < 3) {
      risks.push("recent form rests on fewer than three games per side");
    }
  } else {
    risks.push("no finished games on file for one or both teams");
  }

  // 4. Injuries (each side's penalty moves the other way).
  const pa = injuryPenaltyBps(f.team.injuries);
  const pb = injuryPenaltyBps(f.opponent.injuries);
  if (pa > 0 || pb > 0) {
    const eff = pb - pa;
    bps += eff;
    evidence.push({
      factor: "injuries",
      detail: `${f.team.name} ${String(f.team.injuries.length)} open (${f.team.injuries.map((i) => i.status).join(", ") || "none"}); ${f.opponent.name} ${String(f.opponent.injuries.length)} open (${f.opponent.injuries.map((i) => i.status).join(", ") || "none"})`,
      effectBps: eff,
    });
    if (pa >= 300) risks.push(`${f.team.name} has a player listed out or doubtful`);
  }

  // 5. Head-to-head.
  if (f.headToHead && f.headToHead.teamWins + f.headToHead.opponentWins >= 2) {
    const total = f.headToHead.teamWins + f.headToHead.opponentWins + f.headToHead.ties;
    const share = (f.headToHead.teamWins + f.headToHead.ties / 2) / total;
    const eff = Math.round((share - 0.5) * 800);
    bps += eff;
    evidence.push({
      factor: "head-to-head",
      detail: `${String(f.headToHead.teamWins)}-${String(f.headToHead.opponentWins)}${f.headToHead.ties > 0 ? `-${String(f.headToHead.ties)}` : ""} over recent meetings`,
      effectBps: eff,
    });
  }

  // 6. Live score (dominant while the game is on).
  if (f.live) {
    const margin = f.live.teamScore - f.live.opponentScore;
    const eff = Math.max(-3000, Math.min(3000, margin * 250));
    bps += eff;
    evidence.push({
      factor: "live score",
      detail: `${f.team.name} ${String(f.live.teamScore)}–${String(f.live.opponentScore)} in play`,
      effectBps: eff,
    });
    risks.push("in-play: the price and the score can move faster than this analysis");
  }

  const probabilityBps = clamp(bps);

  // Market comparison and risks about the market itself.
  const market = f.marketImpliedBps;
  const discrepancyBps = market === null ? null : probabilityBps - market;
  if (market === null) risks.push("no market price captured yet — nothing to compare against");
  if (f.marketAgeSeconds !== null && f.marketAgeSeconds > 15 * 60) {
    risks.push(`market price capture is ${String(Math.round(f.marketAgeSeconds / 60))} min old`);
  }
  if (f.liquidityUsdc !== null && f.liquidityUsdc < 500) {
    risks.push(`thin pool (≈$${String(Math.round(f.liquidityUsdc))} depth) — impact will be high`);
  }
  if (f.liquidityUsdc === null) risks.push("pool depth unknown");
  if (f.delayed) risks.push("slate served from a delayed copy");
  if (f.gameStatus === "final")
    risks.push("the game is final — the market is closed to new positions");

  // Confidence from evidence breadth and data freshness.
  const strong = evidence.filter((e) => e.factor !== "venue").length;
  const confidence: SportsAnalysis["confidence"] =
    strong >= 3 && !f.delayed && (f.marketAgeSeconds === null || f.marketAgeSeconds <= 15 * 60)
      ? "high"
      : strong >= 2
        ? "medium"
        : "low";

  let suggested: SportsAnalysis["suggestedAction"];
  if (discrepancyBps === null) {
    suggested = {
      kind: "no_market_price",
      rationale: "The market has no captured price; wait for the pool to post before comparing.",
    };
  } else if (f.gameStatus === "final") {
    suggested = { kind: "hold", rationale: "The game is final; there is nothing to trade." };
  } else if (discrepancyBps >= EDGE_THRESHOLD_BPS) {
    suggested = {
      kind: "consider_buy_yes",
      rationale: `Estimate ${String(probabilityBps)} bps vs market ${String(market)} bps: the market looks ${String(discrepancyBps)} bps cheap on ${f.team.name}. Size with mantua_simulate_trade; the user decides.`,
    };
  } else if (discrepancyBps <= -EDGE_THRESHOLD_BPS) {
    suggested = {
      kind: "consider_fade",
      rationale: `Estimate ${String(probabilityBps)} bps vs market ${String(market)} bps: the market looks ${String(-discrepancyBps)} bps rich on ${f.team.name}. The other side's YES, or selling an existing position, is the fade; simulate before asking.`,
    };
  } else {
    suggested = {
      kind: "hold",
      rationale: `Estimate and market are within ${String(EDGE_THRESHOLD_BPS)} bps; no edge worth the fee and impact.`,
    };
  }

  return {
    probabilityBps,
    method:
      "Additive bps adjustments on a 50/50 baseline: venue (±250–300), season record (win% gap × 5000), recent form (gap × 2000), injuries (out/doubtful −300, questionable −100 per player, capped 900), head-to-head (share × 800), live margin (250/pt, capped ±3000); clamped 5–95%.",
    evidence,
    riskFactors: risks,
    discrepancyBps,
    confidence,
    suggestedAction: suggested,
    disclaimers: [
      "A reasoning aid over Mantua's canonical data, not a prediction; prediction-market prices are not betting advice.",
      "Every trade still goes through mantua_simulate_trade and the user's explicit confirm.",
    ],
  };
}
