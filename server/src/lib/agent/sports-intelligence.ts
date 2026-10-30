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
  /** Task 079 slice 3 — points scored and allowed over this season's finals
   *  (absent or null when the caller has no scores). */
  margin?: { pointsFor: number; pointsAgainst: number; games: number } | null;
  /** Open injuries: status strings as the provider reports them. Goal 3:
   *  `reportedAt` and `gamesSince` (finals the team has played since the
   *  report) let a long-standing absence be recognised as already in the
   *  record rather than penalised again. */
  injuries: {
    status: string;
    player: string | null;
    position: string | null;
    reportedAt?: string | null;
    gamesSince?: number | null;
  }[];
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
  /** Goal 2 — the arithmetic, term by term, in one unit. */
  attribution: {
    units: "bps";
    baselineBps: number;
    terms: { factor: string; effectBps: number }[];
    sumBps: number;
    /** The bound the sum hit, when the clamp changed the number. */
    clampedTo: number | null;
    finalBps: number;
  };
  /** Goal 3 — every injury considered, with what it cost and why. */
  injuryContributions: { team: InjuryContribution[]; opponent: InjuryContribution[] };
  disclaimers: string[];
}

export interface InjuryContribution {
  player: string | null;
  position: string | null;
  status: string;
  reportedAt: string | null;
  gamesSince: number | null;
  impactBps: number;
  rationale: string;
}

const HOME_ADVANTAGE_BPS: Record<string, number> = { nfl: 250, wnba: 300 };
const DEFAULT_HOME_ADVANTAGE_BPS = 250;
/** Edge the estimate must show over the market before suggesting a side. */
export const EDGE_THRESHOLD_BPS = 500;

/** Prior games at .500 mixed into a record, so four weeks of results do
 *  not read like a full season (owner report 2026-10-05: 1-3 vs 3-1 was
 *  moving the estimate 25 points). */
const RECORD_PRIOR_GAMES = 8;
const FORM_PRIOR_GAMES = 3;
/** Games of record below which an estimate is never "high" confidence. */
const EARLY_SEASON_GAMES = 6;

/** A quarterback out, doubtful or on injured reserve: the one absence that moves a line alone. */
const QB_OUT_BPS = 700;
const QB_QUESTIONABLE_BPS = 250;
const PLAYER_OUT_BPS = 150;
const PLAYER_QUESTIONABLE_BPS = 50;
/**
 * The most an injury report can move a side. Was 900 until 2026-10-27:
 * the Eagles with Hurts on IR, two starters out and Barkley questionable
 * were priced 13 points above the books, and 900 could not express that.
 */
const INJURY_CAP_BPS = 2000;
/** Goal 3 — an absence the team has already played this many finals
 *  without is in the record and form terms; counting it again would be
 *  double counting (D-127). */
const LONG_STANDING_GAMES = 3;

/**
 * The named weights, exported for the forecast ledger's model version: a
 * change here is a new version (forecast/model-version.ts).
 */
/** Task 079 slice 3 — point differential. Each side's season margin per
 *  game is shrunk toward zero by `MARGIN_PRIOR_GAMES`, the gap is worth
 *  `MARGIN_BPS_PER_POINT` and the whole term is capped. The weight is
 *  chosen by the reconstruction (`npm run estimator:reconstruct`), never
 *  by closeness to a book; see docs/tasks/079 §8. */
const RECORD_GAP_BPS = 5000;
const FORM_GAP_BPS = 2000;
const MARGIN_BPS_PER_POINT = 0;
const MARGIN_PRIOR_GAMES = 8;
const MARGIN_CAP_BPS = 1500;

export const ESTIMATOR_WEIGHTS: Record<string, number> = {
  homeAdvantageBps: DEFAULT_HOME_ADVANTAGE_BPS,
  edgeThresholdBps: EDGE_THRESHOLD_BPS,
  recordPriorGames: RECORD_PRIOR_GAMES,
  recordGapBps: RECORD_GAP_BPS,
  formPriorGames: FORM_PRIOR_GAMES,
  formGapBps: FORM_GAP_BPS,
  marginBpsPerPoint: MARGIN_BPS_PER_POINT,
  marginPriorGames: MARGIN_PRIOR_GAMES,
  marginCapBps: MARGIN_CAP_BPS,
  earlySeasonGames: EARLY_SEASON_GAMES,
  qbOutBps: QB_OUT_BPS,
  qbQuestionableBps: QB_QUESTIONABLE_BPS,
  playerOutBps: PLAYER_OUT_BPS,
  playerQuestionableBps: PLAYER_QUESTIONABLE_BPS,
  injuryCapBps: INJURY_CAP_BPS,
  longStandingGames: LONG_STANDING_GAMES,
};

function gamesOf(r: { wins: number; losses: number; ties: number } | null): number {
  return r ? r.wins + r.losses + r.ties : 0;
}

/** Win share shrunk toward .500 by `RECORD_PRIOR_GAMES`. */
function winPct(r: { wins: number; losses: number; ties: number } | null): number | null {
  if (!r) return null;
  const games = gamesOf(r);
  if (games === 0) return null;
  return (r.wins + r.ties / 2 + RECORD_PRIOR_GAMES / 2) / (games + RECORD_PRIOR_GAMES);
}

/** Recent-form share shrunk toward .500 by `FORM_PRIOR_GAMES`. */
function formPct(form: readonly ("W" | "L" | "T")[]): number | null {
  if (form.length === 0) return null;
  const pts = form.reduce((acc, r) => acc + (r === "W" ? 1 : r === "T" ? 0.5 : 0), 0);
  return (pts + FORM_PRIOR_GAMES / 2) / (form.length + FORM_PRIOR_GAMES);
}

/**
 * Bps a side loses to its injury report. A quarterback out or doubtful is
 * the one absence that moves a line on its own; other players count a
 * little each. Injured reserve is not counted for other positions — those
 * absences are in the record — but a quarterback on IR is counted as out:
 * the record only absorbs the loss once games have been played without
 * him, and the week he goes on IR it says nothing (2026-10-27, Hurts).
 */
function injuryPenalty(injuries: SideFacts["injuries"]): {
  bps: number;
  items: InjuryContribution[];
} {
  let raw = 0;
  const items: InjuryContribution[] = [];
  for (const i of injuries) {
    const s = i.status.toLowerCase();
    const qb = (i.position ?? "").toUpperCase() === "QB";
    const since = i.gamesSince ?? null;
    let impact = 0;
    let rationale: string;
    if (since !== null && since >= LONG_STANDING_GAMES) {
      rationale = `long-standing: ${String(since)} games played without him — already in the record and form, not counted again`;
    } else if (s === "ir") {
      impact = qb ? QB_OUT_BPS : 0;
      rationale = qb
        ? "quarterback on injured reserve, recent: counted as out until the record absorbs it"
        : "injured reserve, non-quarterback: not counted (the record carries it)";
    } else if (s.includes("out") || s.includes("doubtful")) {
      impact = qb ? QB_OUT_BPS : PLAYER_OUT_BPS;
      rationale = qb ? "quarterback out or doubtful" : "starter out or doubtful";
    } else if (s.includes("questionable") || s.includes("day") || s.includes("probable")) {
      impact = qb ? QB_QUESTIONABLE_BPS : PLAYER_QUESTIONABLE_BPS;
      rationale = qb ? "quarterback questionable" : "player questionable";
    } else {
      rationale = `status "${i.status}" carries no weight`;
    }
    raw += impact;
    items.push({
      player: i.player,
      position: i.position,
      status: i.status,
      reportedAt: i.reportedAt ?? null,
      gamesSince: since,
      impactBps: impact,
      rationale,
    });
  }
  return { bps: Math.min(raw, INJURY_CAP_BPS), items };
}

/** Season margin per game, shrunk toward zero by `prior` phantom games. */
function marginPerGame(m: SideFacts["margin"] | undefined, prior: number): number | null {
  if (!m || m.games === 0) return null;
  return (m.pointsFor - m.pointsAgainst) / (m.games + prior);
}

const signed = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

function clamp(bps: number, lo = 500, hi = 9500): number {
  return Math.max(lo, Math.min(hi, Math.round(bps)));
}

/** Pure: the estimate, its evidence, risks and the market comparison. */
export function analyzeSide(
  f: AnalysisFacts,
  /** Evaluation only (the reconstruction grid): weights to try in place of the deployed ones. */
  overrides: Partial<Record<string, number>> = {},
): SportsAnalysis {
  const W = { ...ESTIMATOR_WEIGHTS, ...overrides } as Record<string, number>;
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
    const eff = Math.round((a - b) * (W["recordGapBps"] ?? RECORD_GAP_BPS));
    bps += eff;
    evidence.push({
      factor: "season record",
      detail: `${f.team.name} ${String(f.team.record?.wins)}-${String(f.team.record?.losses)} vs ${f.opponent.name} ${String(f.opponent.record?.wins)}-${String(f.opponent.record?.losses)}`,
      effectBps: eff,
    });
    const fewest = Math.min(gamesOf(f.team.record), gamesOf(f.opponent.record));
    if (fewest < EARLY_SEASON_GAMES) {
      risks.push(`early season: records rest on ${String(fewest)} game(s), weighted toward .500`);
    }
  } else {
    risks.push("no season record for one or both teams — strength unweighted");
  }

  // 2b. Point differential (Task 079 slice 3) — margin per game shrunk
  // toward zero, the gap in bps per point, capped. Off while the weight is 0.
  const perPoint = W["marginBpsPerPoint"] ?? MARGIN_BPS_PER_POINT;
  const ma = marginPerGame(f.team.margin, W["marginPriorGames"] ?? MARGIN_PRIOR_GAMES);
  const mb = marginPerGame(f.opponent.margin, W["marginPriorGames"] ?? MARGIN_PRIOR_GAMES);
  if (perPoint > 0 && ma !== null && mb !== null) {
    const cap = W["marginCapBps"] ?? MARGIN_CAP_BPS;
    const eff = Math.max(-cap, Math.min(cap, Math.round((ma - mb) * perPoint)));
    bps += eff;
    evidence.push({
      factor: "point differential",
      detail: `${f.team.name} ${signed(ma)}/game vs ${f.opponent.name} ${signed(mb)}/game (season, shrunk)`,
      effectBps: eff,
    });
  }

  // 3. Recent form.
  const fa = formPct(f.team.recentForm);
  const fb = formPct(f.opponent.recentForm);
  if (fa !== null && fb !== null) {
    const eff = Math.round((fa - fb) * (W["formGapBps"] ?? FORM_GAP_BPS));
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
  const ia = injuryPenalty(f.team.injuries);
  const ib = injuryPenalty(f.opponent.injuries);
  const pa = ia.bps;
  const pb = ib.bps;
  const counted = (items: InjuryContribution[]) => items.filter((x) => x.impactBps > 0).length;
  if (pa > 0 || pb > 0) {
    const eff = pb - pa;
    bps += eff;
    evidence.push({
      factor: "injuries",
      detail: `${f.team.name} −${String(pa)} (${String(counted(ia.items))} of ${String(ia.items.length)} open counted); ${f.opponent.name} −${String(pb)} (${String(counted(ib.items))} of ${String(ib.items.length)} open counted); long-standing absences are in the record, not here`,
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
  // Goal 2 — the arithmetic as applied, so the number can be audited.
  const sumBps = Math.round(bps);
  const attribution: SportsAnalysis["attribution"] = {
    units: "bps",
    baselineBps: 5000,
    terms: evidence.map((e) => ({ factor: e.factor, effectBps: e.effectBps })),
    sumBps,
    clampedTo: probabilityBps === sumBps ? null : probabilityBps,
    finalBps: probabilityBps,
  };

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
  const seasoned =
    Math.min(gamesOf(f.team.record), gamesOf(f.opponent.record)) >= EARLY_SEASON_GAMES;
  const confidence: SportsAnalysis["confidence"] =
    strong >= 3 &&
    seasoned &&
    !f.delayed &&
    (f.marketAgeSeconds === null || f.marketAgeSeconds <= 15 * 60)
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
    attribution,
    injuryContributions: { team: ia.items, opponent: ib.items },
    method: `Additive bps adjustments on a 50/50 baseline: venue (±250–300), season record (win-share gap × ${String(W["recordGapBps"])}, each share weighted toward .500 by 8 prior games), point differential (${perPoint > 0 ? `season margin per game shrunk by 8 prior games, gap × ${String(perPoint)}/pt, capped ±${String(W["marginCapBps"])}` : "off"}), recent form (gap × ${String(W["formGapBps"])}, weighted toward .500 by 3 games), injuries (out/doubtful −150 per player, −700 for a quarterback; questionable −50, −250 for a quarterback; a quarterback on injured reserve counts as out, other IR not counted; an absence the team has already played ${String(LONG_STANDING_GAMES)} finals without is in the record and not counted again; capped 2000), head-to-head (share × 800), live margin (250/pt, capped ±3000); clamped 5–95%.`,
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
