/**
 * A sportsbook-implied home win probability from ESPN's odds block (owner
 * report 2026-10-05): the closing moneyline with the vig removed, else the
 * point spread. It is the book's line, not Mantua's estimate — callers
 * label it that way.
 */
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** American odds ("-485", "+370") → implied probability, vig included. */
export function americanToProbability(odds: string): number | null {
  const n = Number(odds.replace("+", ""));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

/** NFL margin-of-victory spread (σ ≈ 13.5 pts) → home win probability. */
export function spreadToHomeProbability(homeSpread: number): number {
  const z = -homeSpread / 13.5;
  // Abramowitz–Stegun normal CDF approximation.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/**
 * The home side's win probability from a competition's odds block, in bps:
 * the closing moneyline with the vig removed when both sides are posted,
 * else the point spread. Undefined when neither is usable.
 */
export function impliedHomeWinProbabilityBps(competition: Rec): number | undefined {
  const first = rec(arr(competition["odds"])[0]);
  if (!first) return undefined;
  const ml = rec(first["moneyline"]);
  const side = (k: "home" | "away") => {
    const s = rec(ml?.[k]);
    const odds = str(rec(s?.["close"])?.["odds"]) ?? str(rec(s?.["open"])?.["odds"]);
    return odds ? americanToProbability(odds) : null;
  };
  const home = side("home");
  const away = side("away");
  let p: number | null = null;
  if (home !== null && away !== null) p = home / (home + away);
  else {
    const spread = num(first["spread"]);
    if (spread !== undefined && Math.abs(spread) <= 30) p = spreadToHomeProbability(spread);
  }
  if (p === null || p <= 0.02 || p >= 0.98) return undefined;
  return Math.round(p * 10_000);
}
