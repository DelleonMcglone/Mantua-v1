import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "./logger.ts";

/**
 * Pyth Network price source via the Hermes REST API — first-party, signed
 * off-chain prices (no on-chain call, no RPC, no gas). This is the primary
 * source behind `getUsdPrice` / the peg signals, with DefiLlama as the automatic
 * fallback (see `usd-pricing.ts`), so an outage degrades gracefully.
 *
 * We read the latest parsed price per feed id and compute `price * 10^expo`.
 */

const TTL_MS = 60_000;

/** FX.EUR/USD — the EUR reference used to measure EURC's (FX-neutral) peg. */
export const PYTH_EUR_USD_FEED_ID =
  "a995d00bb36a63cef7fd2c287dc105fc8f3d93779f062f09551b0af3e81ec30b";

const hermesResponseSchema = z.object({
  parsed: z
    .array(
      z.object({
        id: z.string(),
        price: z.object({ price: z.string(), expo: z.number() }),
      }),
    )
    .optional()
    .default([]),
});

interface CacheEntry {
  value: Record<string, number>;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();

/** Hermes returns/accepts feed ids as lowercase hex without the `0x` prefix. */
function normalizeId(id: string): string {
  return id.toLowerCase().replace(/^0x/, "");
}

/**
 * Latest USD prices for the given Pyth feed ids, keyed by normalized feed id.
 * Missing/failed feeds are simply absent from the map (callers fall back).
 */
export async function getPythPrices(feedIds: readonly string[]): Promise<Record<string, number>> {
  const ids = [...new Set(feedIds.map(normalizeId).filter(Boolean))].sort();
  if (ids.length === 0) return {};

  const key = ids.join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value;

  let value: Record<string, number>;
  try {
    const qs = ids.map((id) => `ids[]=${id}`).join("&");
    const url = `${env.PYTH_HERMES_URL}/v2/updates/price/latest?${qs}&parsed=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      logger.warn({ status: res.status }, "pyth hermes fetch failed");
      return hit?.value ?? {};
    }
    const parsed = hermesResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      logger.warn({ err: parsed.error.issues }, "pyth hermes schema mismatch");
      return hit?.value ?? {};
    }
    const out: Record<string, number> = {};
    for (const item of parsed.data.parsed) {
      const v = Number(item.price.price) * 10 ** item.price.expo;
      if (Number.isFinite(v) && v > 0) out[normalizeId(item.id)] = v;
    }
    value = out;
  } catch (err) {
    logger.warn({ err }, "pyth hermes request errored");
    return hit?.value ?? {};
  }

  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

/** Latest USD price for a single Pyth feed id, or null if unavailable. */
export async function getPythPrice(feedId: string): Promise<number | null> {
  const m = await getPythPrices([feedId]);
  return m[normalizeId(feedId)] ?? null;
}
