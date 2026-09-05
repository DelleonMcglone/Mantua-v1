/**
 * C-011 GAP-3 — pure logic for the claim-winnings UI, kept free of React so
 * it is unit-testable with the repo's plain `tsx --test` runner. The hook
 * (`use-market-redeem.ts`) and the ClaimWinnings component consume this.
 */

/** One claimable side, as reported by GET /api/markets/redeemable. */
export interface RedeemableRow {
  marketId: string;
  label: string;
  league: string | null;
  providerEventId: string | null;
  /** RESOLVED | SETTLED | INVALID. */
  state: string;
  side: "yes" | "no";
  tokenAddress: string;
  balanceRaw: string;
  payoutRaw: string;
}

export type RedeemPhaseKind = "idle" | "preparing" | "signing" | "confirming" | "done" | "error";

/**
 * Button copy per phase. Chainless by design — the user claims winnings,
 * they don't "submit transactions".
 */
export function claimLabel(kind: RedeemPhaseKind): string {
  switch (kind) {
    case "preparing":
      return "Preparing…";
    case "signing":
      return "Confirm in your wallet…";
    case "confirming":
      return "Claiming…";
    case "done":
      return "Claimed";
    default:
      return "Claim winnings";
  }
}

/** True while a claim is in flight — other claim buttons should disable. */
export function isClaimBusy(kind: RedeemPhaseKind): boolean {
  return kind === "preparing" || kind === "signing" || kind === "confirming";
}

/** Raw 6dp USDC string → USD number for `usd()` formatting. */
export function payoutUsd(payoutRaw: string): number {
  const n = Number(payoutRaw);
  return Number.isFinite(n) ? n / 1e6 : 0;
}

/** One market can list two claimable sides (a voided market pays both), but
 *  a single redemption call clears them all — so the UI claims per market. */
export interface RedeemableClaim {
  marketId: string;
  label: string;
  league: string | null;
  providerEventId: string | null;
  state: string;
  sides: RedeemableRow[];
  /** Estimated USD payout for the whole claim. */
  totalUsd: number;
}

/** Group side rows into one claim per market, preserving listing order. */
export function groupClaims(rows: RedeemableRow[]): RedeemableClaim[] {
  const byMarket = new Map<string, RedeemableClaim>();
  for (const row of rows) {
    const existing = byMarket.get(row.marketId);
    if (existing) {
      existing.sides.push(row);
      existing.totalUsd += payoutUsd(row.payoutRaw);
    } else {
      byMarket.set(row.marketId, {
        marketId: row.marketId,
        label: row.label,
        league: row.league,
        providerEventId: row.providerEventId,
        state: row.state,
        sides: [row],
        totalUsd: payoutUsd(row.payoutRaw),
      });
    }
  }
  return [...byMarket.values()];
}

/** Total estimated USD across every claim. */
export function totalClaimableUsd(claims: RedeemableClaim[]): number {
  return claims.reduce((sum, c) => sum + c.totalUsd, 0);
}
