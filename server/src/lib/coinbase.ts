import { z } from "zod";
import { logger } from "./logger.ts";

/**
 * Coinbase read-only market data — public endpoints only (no auth, no API
 * key, no Trade/Transfer scope). Two sources:
 *   - Advanced Trade public market data (`/api/v3/brokerage/market`) for
 *     products that exist there (e.g. BTC-USD) — richer: 24h change + volume.
 *   - Legacy public spot (`/v2/prices/{pair}/spot`) for plain prices,
 *     including EURC-USD / USDC-USD which Advanced Trade doesn't list.
 *
 * Trading/order/transfer endpoints are intentionally NOT wrapped here —
 * this module is data-only. Mirrors the cached-fetch pattern in
 * `defillama.ts` (60s TTL, zod-validated, never throws on upstream error).
 */
const ADV_BASE = "https://api.coinbase.com/api/v3/brokerage/market";
const SPOT_BASE = "https://api.coinbase.com/v2/prices";
const TTL_MS = 60_000;
const PAIR_RE = /^[A-Z0-9]{2,10}-[A-Z]{3,5}$/;

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value as T;
  const value = await fetcher();
  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

const spotSchema = z.object({
  data: z.object({ amount: z.string(), base: z.string(), currency: z.string() }),
});

const marketSchema = z
  .object({
    product_id: z.string(),
    price: z.string(),
    price_percentage_change_24h: z.string().optional(),
    volume_24h: z.string().optional(),
  })
  .loose();

export interface CoinbaseMarket {
  productId: string;
  price: number;
  change24hPct: number | null;
  volume24h: number | null;
}

function assertPair(pair: string): void {
  if (!PAIR_RE.test(pair)) throw new Error(`Invalid Coinbase product id: ${pair}`);
}

/** Spot USD price for a pair (e.g. "EURC-USD"); null on upstream failure. */
export async function getCoinbaseSpot(pair: string): Promise<number | null> {
  assertPair(pair);
  return cached(`spot:${pair}`, async () => {
    const res = await fetch(`${SPOT_BASE}/${pair}/spot`);
    if (!res.ok) {
      logger.warn({ status: res.status, pair }, "coinbase spot fetch failed");
      return null;
    }
    const parsed = spotSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    const n = Number(parsed.data.data.amount);
    return Number.isFinite(n) ? n : null;
  });
}

/** Advanced Trade market data (price + 24h change + volume); null if absent. */
export async function getCoinbaseMarket(productId: string): Promise<CoinbaseMarket | null> {
  assertPair(productId);
  return cached(`market:${productId}`, async () => {
    const res = await fetch(`${ADV_BASE}/products/${productId}`);
    if (!res.ok) {
      logger.warn({ status: res.status, productId }, "coinbase market fetch failed");
      return null;
    }
    const parsed = marketSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    const price = Number(parsed.data.price);
    if (!Number.isFinite(price)) return null;
    const change = Number(parsed.data.price_percentage_change_24h);
    const volume = Number(parsed.data.volume_24h);
    return {
      productId: parsed.data.product_id,
      price,
      change24hPct: Number.isFinite(change) ? change : null,
      volume24h: Number.isFinite(volume) ? volume : null,
    };
  });
}
