/**
 * Phase 12 (D-001 / D-006) — market depth for a constant-product pool.
 *
 * A Uniswap v4 pool has no order book; the honest depth artefact is the
 * cost of moving the price. With active-range liquidity L (raw, the v4
 * `getLiquidity` value over 6-decimal USDC and 6-decimal outcome tokens)
 * and price p (USDC per contract, = implied probability):
 *
 *   buy to p'  (p' > p): USDC in   = L·(√p' − √p)      contracts out = L·(1/√p − 1/√p')
 *   sell to p' (p' < p): contracts in = L·(1/√p' − 1/√p)   USDC out = L·(√p − √p')
 *
 * The curve holds while the price stays inside the active tick range,
 * which is where every Mantua market pool is seeded (full-range LP).
 */
import { poolLiquidityUsdc } from "./market-discover.ts";

const USDC_SCALE = 1e6;
/** Price moves the curve is quoted at, in basis points from the current price. */
export const DEPTH_STEPS_BPS = [100, 200, 500, 1000, 2000] as const;
const MIN_BPS = 100;
const MAX_BPS = 9900;

export interface DepthLevel {
  side: "buy" | "sell";
  /** The price this level reaches, in bps (cents × 100). */
  priceBps: number;
  /** USDC that moves the price there (buy: paid in; sell: received). */
  usdc: number;
  /** Contracts that change hands on the way. */
  contracts: number;
}

export interface DepthCurve {
  /** Value of the active-range liquidity, 2·L·√p, in USDC. */
  liquidityUsdc: number;
  priceBps: number;
  levels: DepthLevel[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The buy and sell ladders around the current price; null when the pool
 * is not deployed or the price is unknown. Levels the clamp collapses onto
 * the current price are omitted, so a 98¢ market has one buy level.
 */
export function depthCurve(
  liquidityRaw: string | null,
  priceBps: number | null,
): DepthCurve | null {
  if (liquidityRaw === null || priceBps === null) return null;
  const l = Number(liquidityRaw);
  if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(priceBps)) return null;
  const p = Math.min(MAX_BPS, Math.max(MIN_BPS, Math.round(priceBps)));
  const sp = Math.sqrt(p / 10_000);
  const levels: DepthLevel[] = [];
  const seen = new Set<string>();
  const fresh = (side: string, at: number) =>
    !seen.has(`${side}:${String(at)}`) && seen.add(`${side}:${String(at)}`);
  for (const step of DEPTH_STEPS_BPS) {
    const up = Math.min(MAX_BPS, p + step);
    if (up > p && fresh("buy", up)) {
      const s = Math.sqrt(up / 10_000);
      levels.push({
        side: "buy",
        priceBps: up,
        usdc: round2((l * (s - sp)) / USDC_SCALE),
        contracts: round2((l * (1 / sp - 1 / s)) / USDC_SCALE),
      });
    }
    const down = Math.max(MIN_BPS, p - step);
    if (down < p && fresh("sell", down)) {
      const s = Math.sqrt(down / 10_000);
      levels.push({
        side: "sell",
        priceBps: down,
        usdc: round2((l * (sp - s)) / USDC_SCALE),
        contracts: round2((l * (1 / s - 1 / sp)) / USDC_SCALE),
      });
    }
  }
  return { liquidityUsdc: round2(poolLiquidityUsdc(liquidityRaw, p)), priceBps: p, levels };
}
