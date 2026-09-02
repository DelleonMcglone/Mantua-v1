import { logger } from "./logger.ts";

/**
 * CoinGecko trending — the daily-workflow "what's hot" pulse (heatmap-style).
 * Keyless public endpoint; cached 5 minutes so the free-tier rate limit is
 * never a factor; degrades to [] on failure (the agent reports the feed as
 * unavailable instead of failing the briefing).
 */

const URL = "https://api.coingecko.com/api/v3/search/trending";
const TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 8_000;

export interface TrendingCoin {
  name: string;
  symbol: string;
  rank: number | null;
  priceChange24hPct: number | null;
}

let cache: { value: TrendingCoin[]; fetchedAt: number } | null = null;

interface TrendingItemLike {
  item?: {
    name?: string;
    symbol?: string;
    market_cap_rank?: number | null;
    data?: { price_change_percentage_24h?: Record<string, number> };
  };
}

export async function getTrendingCoins(limit = 10): Promise<TrendingCoin[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache.value.slice(0, limit);
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ status: res.status }, "coingecko trending fetch failed");
      return cache?.value.slice(0, limit) ?? [];
    }
    const d = (await res.json()) as { coins?: TrendingItemLike[] };
    const coins: TrendingCoin[] = [];
    for (const c of d.coins ?? []) {
      const item = c.item;
      if (!item || typeof item.name !== "string") continue;
      const usdChange = item.data?.price_change_percentage_24h?.["usd"];
      coins.push({
        name: item.name,
        symbol: typeof item.symbol === "string" ? item.symbol : "?",
        rank: typeof item.market_cap_rank === "number" ? item.market_cap_rank : null,
        priceChange24hPct: typeof usdChange === "number" ? usdChange : null,
      });
    }
    cache = { value: coins, fetchedAt: now };
    return coins.slice(0, limit);
  } catch (err) {
    logger.warn({ err }, "coingecko trending request errored");
    return cache?.value.slice(0, limit) ?? [];
  }
}
