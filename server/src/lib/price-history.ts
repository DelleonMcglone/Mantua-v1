import { getTokenHistoricalPrices } from "./defillama.ts";
import { logger } from "./logger.ts";
import { TOKENS, type TokenSymbol } from "./tokens.ts";

export type HistoryRange = "1H" | "1D" | "TW" | "1M" | "1Y";

export const HISTORY_RANGES: HistoryRange[] = ["1H", "1D", "TW", "1M", "1Y"];

const RANGE_DAYS: Record<HistoryRange, number> = {
  "1H": 1,
  "1D": 1,
  TW: 7,
  "1M": 30,
  "1Y": 365,
};

const RANGE_POINTS: Record<HistoryRange, number> = {
  "1H": 60, // ~1-min resolution after trimming to last hour
  "1D": 144, // ~10-min granularity
  TW: 168, // hourly across 7 days
  "1M": 120, // ~6h granularity
  "1Y": 365, // daily
};

const RANGE_TTL_MS: Record<HistoryRange, number> = {
  "1H": 60_000,
  "1D": 5 * 60_000,
  TW: 15 * 60_000,
  "1M": 30 * 60_000,
  "1Y": 60 * 60_000,
};

interface CacheEntry {
  prices: [number, number][];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Per-token historical USD prices over the requested range. Routes
 * through DefiLlama's `/chart/{coins}` endpoint (open / free tier,
 * unlike the CoinGecko `market_chart` endpoint this used to hit) and
 * returns `[timestampMs, priceUsd]` pairs — same shape CoinGecko
 * returns, so downstream renderers don't need to change.
 *
 * We cache per coin+range with TTLs that scale with range length so
 * short views stay live without overfetching.
 */
export async function getPriceHistory(
  symbol: TokenSymbol,
  range: HistoryRange,
): Promise<[number, number][]> {
  const token = TOKENS[symbol];
  const key = `${token.coingeckoId}:${range}`;
  const ttl = RANGE_TTL_MS[range];
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.prices;
  }

  try {
    const series = await getTokenHistoricalPrices(
      [`coingecko:${token.coingeckoId}`],
      RANGE_DAYS[range],
      RANGE_POINTS[range],
    );
    const prices = series[`coingecko:${token.coingeckoId}`] ?? [];
    cache.set(key, { prices, fetchedAt: Date.now() });
    return prices;
  } catch (err) {
    logger.warn({ err, symbol, range }, "defillama chart errored");
    return cached?.prices ?? [];
  }
}

/**
 * For 1H we still fetch days=1 (the smallest natural lookback) and
 * trim to the last hour locally — a dedicated 1H window isn't
 * supported by DefiLlama's chart sampling either.
 */
export function trimToRange(prices: [number, number][], range: HistoryRange): [number, number][] {
  if (range !== "1H") return prices;
  const cutoff = Date.now() - 60 * 60_000;
  return prices.filter(([ts]) => ts >= cutoff);
}
