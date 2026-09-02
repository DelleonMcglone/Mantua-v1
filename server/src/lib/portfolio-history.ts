import { getPriceHistory, trimToRange, type HistoryRange } from "./price-history.ts";
import { TOKENS } from "./tokens.ts";
import type { UserBalance } from "./user-portfolio.ts";

export interface HistoryPoint {
  ts: number;
  value: number;
}

export interface PortfolioHistory {
  range: HistoryRange;
  series: HistoryPoint[];
  startValue: number;
  endValue: number;
  delta: number;
  pct: number;
}

/**
 * Build a portfolio-value time series over `range` by:
 *   1. Fetching CoinGecko price history per held token.
 *   2. Aligning to the densest token's timestamps (typically ETH).
 *   3. Multiplying each timestamp's price by the user's *current*
 *      balance for that token, then summing across tokens.
 *
 * This is an approximation: it assumes today's holdings were held
 * across the whole window. Real cost-basis accounting would need
 * tx history, which we'll layer on top once `portfolio_transactions`
 * is reliably populated.
 */
export async function getPortfolioHistory(
  balances: UserBalance[],
  range: HistoryRange,
): Promise<PortfolioHistory> {
  const held = balances.filter((b) => b.balanceRaw !== "0" && b.symbol in TOKENS);

  const tokenSeries = await Promise.all(
    held.map(async (b) => {
      const raw = await getPriceHistory(b.symbol, range);
      return { balance: b, history: trimToRange(raw, range) };
    }),
  );

  const populated = tokenSeries.filter((s) => s.history.length > 0);
  if (populated.length === 0) {
    return { range, series: [], startValue: 0, endValue: 0, delta: 0, pct: 0 };
  }

  // Pick the densest series as the timestamp axis so we don't lose
  // resolution to a token that happens to have fewer points.
  const base = populated.reduce((best, cur) =>
    cur.history.length > best.history.length ? cur : best,
  );

  const series: HistoryPoint[] = base.history.map(([ts]) => {
    let total = 0;
    for (const ts_ of populated) {
      const idx = nearestIdx(ts_.history, ts);
      if (idx < 0) continue;
      const price = ts_.history[idx][1];
      const decimals = TOKENS[ts_.balance.symbol].decimals;
      const qty = Number(ts_.balance.balanceRaw) / Math.pow(10, decimals);
      total += qty * price;
    }
    return { ts, value: total };
  });

  const startValue = series[0]?.value ?? 0;
  const endValue = series.at(-1)?.value ?? 0;
  const delta = endValue - startValue;
  const pct = startValue > 0 ? (delta / startValue) * 100 : 0;

  return { range, series, startValue, endValue, delta, pct };
}

/**
 * Linear scan for the index whose timestamp is closest to `target`.
 * Sizes here are small (≤365 daily, ≤288 5-min); binary search would
 * be premature.
 */
function nearestIdx(prices: [number, number][], target: number): number {
  if (prices.length === 0) return -1;
  let bestIdx = 0;
  let bestDiff = Math.abs(prices[0][0] - target);
  for (let i = 1; i < prices.length; i++) {
    const diff = Math.abs(prices[i][0] - target);
    if (diff < bestDiff) {
      bestIdx = i;
      bestDiff = diff;
    }
  }
  return bestIdx;
}
