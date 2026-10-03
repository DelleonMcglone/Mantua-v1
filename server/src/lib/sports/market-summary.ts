/**
 * The Summary card behind a research turn ("…so I can decide how to put
 * $X to work"): one row per game and side with the price, how it moved
 * today, a rating and a one-line rationale. The rating is derived from the
 * same sports_intelligence analysis the single-game tool runs; nothing here
 * is a new model. Pure helpers are exported for tests; the DB walk is thin.
 */
import { analyzeMarket, type EventRow, type SportsToolsDb } from "./agent-sports-tools.ts";

export type Rating = "Lean YES" | "Lean NO" | "Fair" | "Thin" | "No price";

/** Below this depth a market is rated Thin whatever the edge says. */
export const THIN_LIQUIDITY_USDC = 25;

export interface SummaryRow {
  game: string;
  providerEventId: string;
  team: string;
  marketId: string;
  priceBps: number | null;
  /** Change in the YES price over the last 24 h, in points (one decimal). */
  moveTodayPoints: number | null;
  rating: Rating;
  confidence: string;
  liquidityUsdc: number | null;
  rationale: string;
}

export function ratingFor(input: {
  suggested: string | undefined;
  priceBps: number | null;
  liquidityUsdc: number | null;
}): Rating {
  if (input.priceBps === null) return "No price";
  if (input.liquidityUsdc !== null && input.liquidityUsdc < THIN_LIQUIDITY_USDC) return "Thin";
  if (input.suggested === "consider_buy_yes") return "Lean YES";
  if (input.suggested === "consider_fade") return "Lean NO";
  return "Fair";
}

/** Latest price minus the oldest capture inside the window, in points. */
export function moveOverWindow(
  prices: readonly { impliedProbability: string; capturedAt: Date }[],
  now: Date,
  windowHours = 24,
): number | null {
  const since = now.getTime() - windowHours * 3_600_000;
  const inWindow = prices
    .filter((p) => p.capturedAt.getTime() >= since)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const first = inWindow.at(0);
  const last = inWindow.at(-1);
  if (!first || !last || first === last) return null;
  const delta = (Number(last.impliedProbability) - Number(first.impliedProbability)) * 100;
  return Math.round(delta * 10) / 10;
}

/** The first evidence line, trimmed to one sentence for the card. */
export function rationaleFrom(evidence: readonly { factor: string; detail: string }[]): string {
  const top = evidence.at(0);
  if (!top) return "No evidence beyond the price.";
  const text = `${top.factor}: ${top.detail}`;
  return text.length > 110 ? `${text.slice(0, 107)}…` : text;
}

export async function summaryRowFor(
  dbx: SportsToolsDb,
  event: EventRow,
  outcomeIndex: 0 | 1,
  now: Date,
): Promise<SummaryRow | null> {
  const a = await analyzeMarket(dbx, { providerEventId: event.providerEventId, outcomeIndex }, now);
  if (a["status"] !== "ok") return null;
  const market = a["market"] as {
    marketId: string;
    impliedProbabilityBps: number | null;
    liquidityUsdc: number | null;
  } | null;
  const analysis = a["analysis"] as {
    confidence: string;
    evidence: { factor: string; detail: string }[];
    suggestedAction: { kind: string };
  };
  const prices = market ? await dbx.listMarketPrices(market.marketId, 200) : [];
  const priceBps = market?.impliedProbabilityBps ?? null;
  const liquidityUsdc = market?.liquidityUsdc ?? null;
  return {
    game: `${event.awayTeam} at ${event.homeTeam}`,
    providerEventId: event.providerEventId,
    team:
      typeof a["team"] === "string"
        ? a["team"]
        : outcomeIndex === 0
          ? event.homeTeam
          : event.awayTeam,
    marketId: market?.marketId ?? "",
    priceBps,
    moveTodayPoints: moveOverWindow(prices, now),
    rating: ratingFor({ suggested: analysis.suggestedAction.kind, priceBps, liquidityUsdc }),
    confidence: analysis.confidence,
    liquidityUsdc,
    rationale: rationaleFrom(analysis.evidence),
  };
}

const DEFAULT_WINDOW_HOURS = 36;

/**
 * `mantua_compare_markets`: the games the user named (by team), or the
 * next window's games when none were named. Home side unless the team
 * named is the away side.
 */
export async function compareMarkets(
  dbx: SportsToolsDb,
  input: { teams?: unknown; limit?: unknown; budgetUsdc?: unknown; windowHours?: unknown },
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const teams = Array.isArray(input.teams)
    ? input.teams.filter((t): t is string => typeof t === "string" && t.trim() !== "").slice(0, 8)
    : [];
  const limit = Math.min(10, Math.max(1, Number(input.limit) || 5));
  const budgetUsdc = Number(input.budgetUsdc) > 0 ? Number(input.budgetUsdc) : null;
  const league = (await dbx.listLeagues()).find((l) => l.slug === "nfl");
  if (!league) return { status: "unknown_league" };
  const hours = Math.min(168, Math.max(1, Number(input.windowHours) || DEFAULT_WINDOW_HOURS));
  const from = now.getTime() - 4 * 3_600_000;
  const to = now.getTime() + hours * 3_600_000;
  const upcoming = (await dbx.listEventsForLeague(league.id, 500)).filter(
    (e) =>
      (e.status === "scheduled" || e.status === "in_progress") &&
      e.startsAt.getTime() >= from &&
      e.startsAt.getTime() <= to,
  );
  const picks: { event: EventRow; outcomeIndex: 0 | 1 }[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (teams.length > 0) {
    for (const t of teams) {
      const q = norm(t);
      const hit = upcoming.find(
        (e) => norm(e.homeTeam).includes(q) || norm(e.awayTeam).includes(q),
      );
      if (hit) picks.push({ event: hit, outcomeIndex: norm(hit.homeTeam).includes(q) ? 0 : 1 });
    }
  } else {
    for (const e of upcoming.slice(0, limit)) picks.push({ event: e, outcomeIndex: 0 });
  }
  const rows: SummaryRow[] = [];
  for (const p of picks) {
    const row = await summaryRowFor(dbx, p.event, p.outcomeIndex, now);
    if (row) rows.push(row);
  }
  return {
    status: "ok",
    budgetUsdc,
    windowHours: hours,
    requestedTeams: teams,
    rows: rows.slice(0, limit),
    note: "priceBps is the YES price of the named team's side; rating comes from the evidence-weighted estimate (Lean YES / Lean NO / Fair / Thin) and is not a prediction.",
  };
}
