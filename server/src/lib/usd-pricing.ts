import { counters } from "./metrics.ts";
import { logger } from "./logger.ts";
import { getTokenPrices } from "./defillama.ts";
import { getPythPrice } from "./pyth-prices.ts";
import { TOKENS, type TokenSymbol, type Token } from "./tokens.ts";

const TTL_MS = 60_000; // 60s — enough to dampen quote-flow chatter, fresh enough for cap math.

interface CacheEntry {
  usd: number;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Resolve a USD price per unit token. Returns 0 if pricing unavailable
 * (caller should treat that as "skip USD-denominated checks", NOT "free").
 *
 * Primary source is Pyth Hermes (first-party, signed prices), keyed by the
 * token's `pythFeedId`. Falls back to DefiLlama Coins (`coins.llama.fi`, keyed by
 * `coingecko:<id>`) when Pyth is unavailable, then to the last cached value, then
 * 0. An outage on either source degrades gracefully.
 *
 * C-019 — cap-enforcement callers must NOT consume this lenient contract:
 * a $0 valuation from a dead feed turns the spending cap into a no-op
 * exactly when prices are least trustworthy. Enforcement uses
 * `getUsdPriceStrict` / `tokenAmountUsdStrict`, which fail closed.
 */
export async function getUsdPrice(symbol: TokenSymbol): Promise<number> {
  const token = TOKENS[symbol];
  return getUsdPriceForToken(token);
}

async function getUsdPriceForToken(token: Token | undefined): Promise<number> {
  // Tokens with no price source at all simply have no price — return 0 rather
  // than throwing. (All current app tokens are priced via both Pyth + DefiLlama.)
  if (!token || (!token.coingeckoId && !token.pythFeedId)) return 0;
  const cacheKey = token.coingeckoId || (token.pythFeedId ?? token.symbol);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.usd;

  // Pyth first.
  let usd = 0;
  if (token.pythFeedId) {
    const p = await getPythPrice(token.pythFeedId);
    if (p && p > 0) usd = p;
  }
  // DefiLlama fallback → prior cached value → 0.
  if (usd === 0 && token.coingeckoId) {
    const key = `coingecko:${token.coingeckoId}`;
    const fresh = await getTokenPrices([key]);
    usd = fresh[key]?.price ?? cached?.usd ?? 0;
  }

  // Phase 9 / PF-011 (D-116) — the lenient contract may return 0, but never
  // silently: a priced token valued at zero is counted and logged so the
  // alert policy can surface a dead feed instead of a quietly shrunken
  // portfolio.
  if (usd === 0) {
    counters.inc("pricing.fallback_zero");
    logger.warn({ symbol: token.symbol }, "usd-pricing: no live or cached price — valuing at 0");
  }
  cache.set(cacheKey, { usd, fetchedAt: Date.now() });
  return usd;
}

/**
 * C-019 — no feed, no trade. Raised by the strict pricing helpers when no
 * live-or-cached USD price is available, so cap enforcement can fail closed
 * instead of valuing the spend at $0.
 */
export class PriceUnavailableError extends Error {
  readonly symbol: string;

  constructor(symbol: string) {
    super(
      `No USD price available for ${symbol} — spending-cap pricing is fail-closed, blocking the trade`,
    );
    this.name = "PriceUnavailableError";
    this.symbol = symbol;
  }
}

/** Fail-closed guard around a resolved price — the pure core of the strict helpers. */
export function requirePositivePrice(price: number, symbol: string): number {
  if (!(price > 0)) throw new PriceUnavailableError(symbol);
  return price;
}

/** Strict price for `symbol`: throws `PriceUnavailableError` when no positive
 *  price can be resolved. Cap enforcement uses this, never `getUsdPrice`. */
export async function getUsdPriceStrict(symbol: TokenSymbol): Promise<number> {
  return requirePositivePrice(await getUsdPrice(symbol), symbol);
}

/** USD value of `amount` (raw base units) for `symbol`, resolved against the
 *  registry — fail-closed: an unpriced token or a dead feed throws instead of
 *  valuing the spend at $0. Cap enforcement uses this, never `tokenAmountUsd`. */
export async function tokenAmountUsdStrict(
  symbol: TokenSymbol,
  amountRaw: bigint,
): Promise<number> {
  const token = TOKENS[symbol] as Token | undefined;
  if (!token) throw new PriceUnavailableError(symbol);
  const price = await getUsdPriceStrict(symbol);
  const denom = 10 ** token.decimals;
  return (Number(amountRaw) / denom) * price;
}

/** USD value of `amount` (raw base units) for a known token object. Use
 *  this over the symbol-based `tokenAmountUsd` when you already hold the
 *  chain-correct token (the legacy `TOKENS` map is Base-only and lacks
 *  chain-specific tokens like cbBTC). */
export async function tokenAmountUsdForToken(token: Token, amountRaw: bigint): Promise<number> {
  const price = await getUsdPriceForToken(token);
  if (price === 0) return 0;
  const denom = 10n ** BigInt(token.decimals);
  const wholeUnits = Number(amountRaw) / Number(denom);
  return wholeUnits * price;
}

/** USD value of `amount` (raw base units) for `symbol`, resolved against
 *  the legacy Base registry. Returns 0 for unknown symbols. */
export async function tokenAmountUsd(symbol: TokenSymbol, amountRaw: bigint): Promise<number> {
  return tokenAmountUsdForToken(TOKENS[symbol], amountRaw);
}
