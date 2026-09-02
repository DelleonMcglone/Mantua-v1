import { formatUnits } from "viem";
import { TOKENS, ZERO_ADDRESS, type TokenSymbol } from "@/lib/tokens.ts";
import { HOOK_ADDRESS } from "./hook-recommendations.ts";
import type { LocalPosition } from "./local-positions.ts";
import type { Position } from "./positions-types.ts";

function fmtFee(n: number): string {
  if (n === 0) return "0";
  if (n < 0.000001) return "<0.000001";
  return n.toFixed(6).replace(/\.?0+$/, "");
}

/**
 * Human-readable uncollected-fees label from raw base-unit amounts
 * (fees0 = `a`, fees1 = `b`). Returns null when no fee data is present
 * (legacy breadcrumb), or "No fees yet" when both sides are zero.
 */
export function formatFeesEarned(
  fees0: string | undefined,
  fees1: string | undefined,
  a: TokenSymbol,
  b: TokenSymbol,
): string | null {
  if (fees0 === undefined && fees1 === undefined) return null;
  const f0 = fees0 ? Number(formatUnits(BigInt(fees0), TOKENS[a].decimals)) : 0;
  const f1 = fees1 ? Number(formatUnits(BigInt(fees1), TOKENS[b].decimals)) : 0;
  if (f0 === 0 && f1 === 0) return "No fees yet";
  return `${fmtFee(f0)} ${a} · ${fmtFee(f1)} ${b}`;
}

/**
 * Adapt a `LocalPosition` — whether a localStorage breadcrumb or a row
 * discovered on-chain via `/api/positions/onchain` — into the `Position`
 * shape the Remove flow and position lists consume.
 *
 * Carries `id: ""` so the remove path routes by `tokenId` (these positions
 * have no server-side DB row), and resolves the correct per-hook
 * PositionManager from `hookAddress`. Tick / liquidity fields are
 * placeholders — the server reads the authoritative on-chain values from
 * the tokenId at remove time.
 */
export function localPositionToPosition(lp: LocalPosition): Position {
  return {
    id: "",
    tokenId: lp.tokenId,
    tickLower: 0,
    tickUpper: 0,
    liquidity: "0",
    status: "open",
    openedTx: lp.txHash || null,
    closedTx: null,
    createdAt: new Date(lp.createdAt).toISOString(),
    poolKeyHash: "",
    token0: TOKENS[lp.tokenA].address.toLowerCase(),
    token1: TOKENS[lp.tokenB].address.toLowerCase(),
    fee: lp.fee,
    tickSpacing: 0,
    hookAddress: (lp.hook ? HOOK_ADDRESS[lp.hook] : null) ?? ZERO_ADDRESS,
    feesLabel: formatFeesEarned(lp.fees0, lp.fees1, lp.tokenA, lp.tokenB),
  };
}
