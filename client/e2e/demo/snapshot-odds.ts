/**
 * The home-win line from an ESPN competition's odds block, in bps — a
 * mirror of `server/src/lib/sports/espn-odds.ts` for the demo snapshot:
 * ESPN's published win percentage, else the moneyline with the vig
 * removed, else the spread through a normal margin-of-victory model.
 */
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** American odds ("-485", "+370") → implied probability, vig included. */
function americanToProbability(odds: string): number | null {
  const n = Number(odds.replace("+", ""));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

/** NFL margin-of-victory spread (σ ≈ 13.5 pts) → home win probability. */
function spreadToHomeProbability(homeSpread: number): number {
  const z = -homeSpread / 13.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** ESPN's published win percentage, else the moneyline with the vig removed, else the spread. */
export function homeWinBps(competition: Rec): number | undefined {
  const first = rec(arr(competition["odds"])[0]);
  if (!first) return undefined;
  const pct = num(rec(first["homeTeamOdds"])?.["winPercentage"]) ?? num(first["homeWinPercentage"]);
  if (pct !== undefined) return pct <= 0 || pct >= 100 ? undefined : Math.round(pct * 100);
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
