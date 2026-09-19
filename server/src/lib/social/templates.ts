import { charCount, DISCLAIMER, MAX_POST_CHARS } from "./compliance.ts";
import type { MoveExplanation } from "./explain-move.ts";
import type { PostTemplate } from "./posting-policy.ts";
import type { PriceSignal } from "./price-signal.ts";

/**
 * Task 070 / AE-002, AE-003, AE-004 — the post templates. Templates are
 * code over data: the wording is fixed here, the figures come from the
 * market record, and every post ends with the agent's name, its public
 * page and the disclaimer the lint requires. The body is trimmed to the
 * platform limit before the footer is appended, so the footer is never
 * the part that gets cut.
 */

export interface MarketFacts {
  marketId: string;
  league: string | null;
  /** The team whose YES the market prices, and its opponent. */
  team: string;
  opponent: string;
  yesBps: number;
  change24hBps: number | null;
  liquidityUsdc: number | null;
  /** Unix seconds; null when unknown. */
  startsAt: number | null;
  status: "scheduled" | "live" | "final";
  nowSeconds: number;
  agentName: string;
  pageUrl: string;
}

export interface ComposedPost {
  template: PostTemplate;
  marketId: string;
  text: string;
}

const pct = (b: number): string => `${String(Math.round(b / 100))}%`;

function change(b: number | null): string {
  if (b === null || Math.round(b / 100) === 0) return "flat today";
  return `${b > 0 ? "+" : "−"}${String(Math.abs(Math.round(b / 100)))} pts today`;
}

function pool(usdc: number | null): string {
  if (usdc === null) return "";
  const k = usdc >= 1000 ? `$${(usdc / 1000).toFixed(1)}k` : `$${String(Math.round(usdc))}`;
  return ` ${k} in the pool.`;
}

function when(f: MarketFacts): string {
  if (f.status === "live") return " Live now.";
  if (f.status === "final") return " Final.";
  if (f.startsAt === null) return "";
  const hours = (f.startsAt - f.nowSeconds) / 3600;
  if (hours <= 0) return "";
  return hours < 1 ? " Kickoff within the hour." : ` Kickoff in ${String(Math.round(hours))}h.`;
}

function footer(f: MarketFacts): string {
  return `— ${f.agentName} ${f.pageUrl}\n${DISCLAIMER}`;
}

/** Trim the body to what the limit leaves after the footer, at a word. */
function fit(body: string, f: MarketFacts): string {
  const foot = footer(f);
  const budget = MAX_POST_CHARS - charCount(foot) - 1;
  const chars = Array.from(body);
  if (chars.length <= budget) return `${body}\n${foot}`;
  const cut = chars.slice(0, budget - 1).join("");
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > budget / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…\n${foot}`;
}

const league = (f: MarketFacts): string => (f.league ? `${f.league.toUpperCase()}: ` : "");

/** AE-002 — the market at a glance. */
export function marketUpdatePost(f: MarketFacts): string {
  return fit(
    `${league(f)}${f.team} YES at ${pct(f.yesBps)} (${change(f.change24hBps)}) vs ${f.opponent}.${pool(f.liquidityUsdc)}${when(f)}`,
    f,
  );
}

/** AE-003 — why the price moved. */
export function explainMovePost(f: MarketFacts, move: MoveExplanation): string {
  return fit(`${league(f)}${f.team} vs ${f.opponent}. ${move.factors.join(" ")}`, f);
}

/** AE-004 — the price as a signal. */
export function priceSignalPost(f: MarketFacts, signal: PriceSignal): string {
  return fit(`${league(f)}${f.team}. ${signal.statement} Confidence: ${signal.confidence}.`, f);
}

/**
 * Every post the approved templates yield for this market: the update
 * always, the other two only for a notable move with something to say.
 */
export function composePosts(
  f: MarketFacts,
  move: MoveExplanation,
  signal: PriceSignal,
  approved: readonly PostTemplate[],
): ComposedPost[] {
  const out: ComposedPost[] = [];
  const has = (t: PostTemplate): boolean => approved.includes(t);
  if (has("market_update")) {
    out.push({ template: "market_update", marketId: f.marketId, text: marketUpdatePost(f) });
  }
  if (has("explain_move") && move.notable) {
    out.push({ template: "explain_move", marketId: f.marketId, text: explainMovePost(f, move) });
  }
  if (has("price_signal") && signal.kind !== "none" && move.notable) {
    out.push({ template: "price_signal", marketId: f.marketId, text: priceSignalPost(f, signal) });
  }
  return out;
}
