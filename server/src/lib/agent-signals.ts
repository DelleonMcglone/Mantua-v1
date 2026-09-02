import { formatUnits } from "viem";
import { getToken, type TokenSymbol } from "./tokens.ts";
import { getUsdPrice } from "./usd-pricing.ts";
import { getTokenPrices } from "./defillama.ts";
import { getPythPrice, PYTH_EUR_USD_FEED_ID } from "./pyth-prices.ts";
import { quoteAgentSwap } from "./agent-swap.ts";

/**
 * Real-signal layer for the agent's decision logic.
 *
 * Every action the agent takes is grounded in observable data fetched here —
 * not assumptions. `getTradeSignals` returns a structured snapshot (peg
 * deviations, spot prices, the live quote-implied rate / price impact) plus a
 * `verdict` computed against explicit thresholds. The agent surfaces this
 * snapshot via the `get_signals` tool, and the swap path enforces the verdict
 * in code so the guardrail holds regardless of model behaviour.
 *
 * Posture: MODERATE (chosen). A swap that would ACQUIRE a stablecoin more than
 * `maxPegDeviationPct` off its peg, or whose price impact vs spot exceeds
 * `maxPriceImpactPct`, is held. Price impact also captures thin-liquidity /
 * stale-pool risk (a shallow pool fills far from spot).
 *
 * The impact limit is network-aware (same switch as the spending cap):
 * 1% is calibrated for mainnet-depth pools; the `testnet` gate loosens it
 * to 10% for thin dev books. The peg guard (the actual safety property)
 * stays identical on both.
 */

const MAINNET = process.env.MANTUA_NETWORK === "mainnet";

export const SIGNAL_THRESHOLDS = {
  /** Max |deviation| from peg for a stablecoin the swap would acquire (%). */
  maxPegDeviationPct: 0.5,
  /** Max adverse price impact of the swap vs spot (%). */
  maxPriceImpactPct: MAINNET ? 1.0 : 10.0,
} as const;

/** Symbols we treat as pegged stablecoins for the peg guard. */
const PEGGED: readonly TokenSymbol[] = ["USDC", "EURC"] as const;

function isPegged(s: TokenSymbol): boolean {
  return (PEGGED as readonly string[]).includes(s);
}

export interface PegInfo {
  symbol: TokenSymbol;
  priceUsd: number;
  /** Peg target in USD (1.0 for USDC; the EUR reference for EURC). */
  targetUsd: number;
  deviationPct: number;
}

export interface TradeSignal {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  amountOut: number;
  /** tokenOut received per tokenIn, from the live pool quote. */
  quotedRate: number;
  /** tokenOut per tokenIn implied by spot USD prices. */
  spotRate: number;
  /** Positive = filled worse than spot by this %. NaN if prices unavailable. */
  priceImpactPct: number;
}

export interface TradeSignals {
  thresholds: typeof SIGNAL_THRESHOLDS;
  prices: Record<string, number>;
  pegs: PegInfo[];
  trade?: TradeSignal | undefined;
  verdict: { ok: boolean; reasons: string[] };
}

/**
 * True when the signals show the token the swap would ACQUIRE breaching the
 * peg guard. Peg breaches are size-independent (clipping the trade can't fix
 * them), so the resolve path parks the whole swap instead of clipping.
 */
export function pegBreached(signals: TradeSignals, tokenOut: TokenSymbol): boolean {
  if (!isPegged(tokenOut)) return false;
  const peg = signals.pegs.find((p) => p.symbol === tokenOut);
  return peg !== undefined && Math.abs(peg.deviationPct) > SIGNAL_THRESHOLDS.maxPegDeviationPct;
}

/** Peg deviation for a single stablecoin, or null when pricing is unavailable. */
async function pegFor(symbol: TokenSymbol): Promise<PegInfo | null> {
  if (symbol === "USDC") {
    const p = await getUsdPrice("USDC");
    if (!p) return null;
    return { symbol, priceUsd: p, targetUsd: 1, deviationPct: (p - 1) * 100 };
  }
  if (symbol === "EURC") {
    // EURC pegs to EUR, not USD. Measure it FX-neutrally: EURC/USD ÷ EUR/USD.
    // Primary is Pyth (EURC/USD via getUsdPrice, EUR/USD via the FX feed); if
    // either is unavailable, fall back to DefiLlama's euro-coin / agEUR ratio.
    const eurcUsd = await getUsdPrice("EURC");
    const eurUsd = await getPythPrice(PYTH_EUR_USD_FEED_ID);
    if (eurcUsd && eurUsd) {
      return {
        symbol,
        priceUsd: eurcUsd,
        targetUsd: eurUsd,
        deviationPct: (eurcUsd / eurUsd - 1) * 100,
      };
    }
    const m = await getTokenPrices(["coingecko:euro-coin", "coingecko:ageur"]);
    const eurc = m["coingecko:euro-coin"]?.price;
    const ref = m["coingecko:ageur"]?.price;
    if (!eurc || !ref) return null;
    return { symbol, priceUsd: eurc, targetUsd: ref, deviationPct: (eurc / ref - 1) * 100 };
  }
  return null;
}

/**
 * Compute the signal snapshot + verdict. Resilient: when a price feed is
 * unavailable a check is simply omitted (verdict stays ok unless a threshold
 * is definitively breached) — we never block a swap on a flaky feed.
 */
export async function getTradeSignals(args: {
  tokenIn?: TokenSymbol;
  tokenOut?: TokenSymbol;
  amountIn?: string;
}): Promise<TradeSignals> {
  const involved = [args.tokenIn, args.tokenOut].filter(
    (s): s is TokenSymbol => typeof s === "string",
  );
  const symbols =
    involved.length > 0 ? [...new Set(involved)] : (["USDC", "EURC"] as TokenSymbol[]);

  const prices: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (s) => {
      prices[s] = await getUsdPrice(s);
    }),
  );

  const pegTargets = symbols.filter(isPegged);
  const pegList = pegTargets.length > 0 ? pegTargets : (["USDC", "EURC"] as TokenSymbol[]);
  const pegs = (await Promise.all(pegList.map(pegFor))).filter((p): p is PegInfo => p !== null);

  const reasons: string[] = [];
  let trade: TradeSignal | undefined;

  if (args.tokenIn && args.tokenOut && args.amountIn && args.tokenIn !== args.tokenOut) {
    const q = await quoteAgentSwap({
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountIn,
    });
    const amountOut = Number(formatUnits(BigInt(q.amountOutRaw), getToken(args.tokenOut).decimals));
    const amountInNum = Number(args.amountIn);
    const quotedRate = amountInNum > 0 ? amountOut / amountInNum : NaN;
    const priceIn = prices[args.tokenIn] ?? 0;
    const priceOut = prices[args.tokenOut] ?? 0;
    const spotRate = priceIn > 0 && priceOut > 0 ? priceIn / priceOut : NaN;
    const priceImpactPct =
      Number.isFinite(spotRate) && spotRate > 0 && Number.isFinite(quotedRate)
        ? ((spotRate - quotedRate) / spotRate) * 100
        : NaN;
    trade = {
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountIn,
      amountOut,
      quotedRate,
      spotRate,
      priceImpactPct,
    };
    if (Number.isFinite(priceImpactPct) && priceImpactPct > SIGNAL_THRESHOLDS.maxPriceImpactPct) {
      reasons.push(
        `price impact ${priceImpactPct.toFixed(2)}% exceeds the ${String(SIGNAL_THRESHOLDS.maxPriceImpactPct)}% limit (thin liquidity or a stale pool)`,
      );
    }
  }

  // Peg guard applies to the token the swap would ACQUIRE (tokenOut). Selling a
  // depegged asset is fine (fleeing a depeg); acquiring one is the risk.
  if (args.tokenOut && isPegged(args.tokenOut)) {
    const peg = pegs.find((p) => p.symbol === args.tokenOut);
    if (peg && Math.abs(peg.deviationPct) > SIGNAL_THRESHOLDS.maxPegDeviationPct) {
      reasons.push(
        `${args.tokenOut} is ${peg.deviationPct.toFixed(2)}% off its peg (limit ±${String(SIGNAL_THRESHOLDS.maxPegDeviationPct)}%)`,
      );
    }
  }

  return {
    thresholds: SIGNAL_THRESHOLDS,
    prices,
    pegs,
    trade,
    verdict: { ok: reasons.length === 0, reasons },
  };
}
