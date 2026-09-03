/**
 * Earnings tab data — a position's REAL uncollected swap fees, read live from
 * v4 on-chain state (`GET /api/earnings`). No fabricated figures: positions
 * with no accrued fees report 0; the tab shows $0 until liquidity earns fees.
 */

export type EarningsNetwork = "base";

/** One open position's uncollected fees (mirrors the server payload). */
export interface EarningPosition {
  tokenId: string;
  hookAddress: string | null;
  /** Hook powering the pool ("stable-protection" | "dynamic-fee") or null. */
  hookName: string | null;
  sym0: string;
  sym1: string;
  /** Raw token units (stringified bigint). */
  accrued0: string;
  accrued1: string;
  /** Human-readable token amounts. */
  accrued0Human: number;
  accrued1Human: number;
  /** Best-effort USD value of the accrued fees. */
  accruedUsd: number;
  /** ESTIMATED split of the accrued fees: LP-base portion vs. hook-driven
   *  portion. `estimated` is true for hooked pools (the dynamic fee varies
   *  per swap, so this is an approximation, not exact accounting). */
  lpFeesUsd: number;
  hookFeesUsd: number;
  hookShareBps: number;
  estimated: boolean;
}

/** Grouped-by-hook earnings summary row (mirrors the server payload). */
export interface HookGroup {
  hookName: string | null;
  label: string;
  lpFeesUsd: number;
  hookFeesUsd: number;
  totalUsd: number;
  positionCount: number;
}

export interface EarningsData {
  totalAccruedUsd: number;
  totalLpFeesUsd: number;
  totalHookFeesUsd: number;
  positions: EarningPosition[];
  byHook: HookGroup[];
}

/** Positions currently holding a non-zero accrued fee balance. */
export function earningPoolCount(data: EarningsData | null): number {
  if (!data) return 0;
  return data.positions.filter(
    (p) => p.accruedUsd > 0 || p.accrued0Human > 0 || p.accrued1Human > 0,
  ).length;
}

// USD + token amounts render through the canonical `@/lib/format.ts`
// (`usd` / `token`) — the local `fmtUsd` / `fmtToken` copies were deleted
// in B-015's formatter unification.

export function shortenHash(hash: string): string {
  if (hash.length <= 13) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}
