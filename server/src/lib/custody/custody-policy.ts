import { can, type InstitutionRole } from "./custody-roles.ts";

/**
 * Task 073 / IC-001, IC-002 — the institution-level gates. Pure: the
 * callers (`custody-gate.ts` inside `checkSpendingCap`, the withdrawal
 * request path) load the rows and pass the numbers.
 *
 * The rules, in the order they are checked: the institution is active;
 * the member is active and holds the permission; the institution has a
 * wallet set and the wallet is in it (segregation is not a label — a
 * wallet outside the set cannot spend); the per-trade cap; the
 * institution's aggregate daily cap across every member wallet.
 */

export interface InstitutionLimits {
  /** pending | active | suspended */
  status: string;
  circleWalletSetId: string | null;
  perTradeCapUsd: number;
  dailyCapUsd: number;
  /** Withdrawals at or above this need a second approver; 0 = all of them. */
  approvalThresholdUsd: number;
}

export interface MemberView {
  userId: string;
  role: InstitutionRole;
  /** active | removed */
  status: string;
}

export type CustodyRefusalCode =
  | "institution_inactive"
  | "member_inactive"
  | "member_cannot_trade"
  | "member_cannot_withdraw"
  | "wallet_set_unprovisioned"
  | "wallet_unsegregated"
  | "per_trade_cap"
  | "institution_daily_cap"
  | "destination_unverified"
  | "destination_chain_mismatch";

export interface CustodyRefusal {
  ok: false;
  code: CustodyRefusalCode;
  message: string;
}

export interface SpendContext {
  institution: InstitutionLimits;
  member: MemberView;
  /** The spending wallet's recorded wallet set (null = the retail set). */
  walletSetId: string | null;
  usd: number;
  /** Today's spend across every wallet of the institution (USD). */
  spentTodayUsd: number;
}

const refuse = (code: CustodyRefusalCode, message: string): CustodyRefusal => ({
  ok: false,
  code,
  message,
});

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function standing(ctx: SpendContext, permission: "trade" | "request_withdrawal") {
  if (ctx.institution.status !== "active") {
    return refuse("institution_inactive", `The institution is ${ctx.institution.status}.`);
  }
  if (ctx.member.status !== "active") {
    return refuse("member_inactive", "Your membership is not active.");
  }
  if (!can(ctx.member.role, permission)) {
    return permission === "trade"
      ? refuse("member_cannot_trade", `The ${ctx.member.role} role cannot trade.`)
      : refuse("member_cannot_withdraw", `The ${ctx.member.role} role cannot request withdrawals.`);
  }
  if (!ctx.institution.circleWalletSetId) {
    return refuse(
      "wallet_set_unprovisioned",
      "The institution's custody wallet set is not provisioned.",
    );
  }
  if (ctx.walletSetId !== ctx.institution.circleWalletSetId) {
    return refuse(
      "wallet_unsegregated",
      "This wallet is outside the institution's custody wallet set. Move it first.",
    );
  }
  if (ctx.usd > ctx.institution.perTradeCapUsd) {
    return refuse(
      "per_trade_cap",
      `${usd(ctx.usd)} exceeds the institution's per-trade cap of ${usd(ctx.institution.perTradeCapUsd)}.`,
    );
  }
  if (ctx.spentTodayUsd + ctx.usd > ctx.institution.dailyCapUsd) {
    return refuse(
      "institution_daily_cap",
      `The institution's daily cap of ${usd(ctx.institution.dailyCapUsd)} would be exceeded (${usd(ctx.spentTodayUsd)} spent today, +${usd(ctx.usd)}).`,
    );
  }
  return null;
}

/** Every money path from an institutional wallet. */
export function spendGate(ctx: SpendContext): { ok: true } | CustodyRefusal {
  return standing(ctx, "trade") ?? { ok: true };
}

export interface WithdrawalContext extends SpendContext {
  destination: { status: string; chainId: number } | null;
  chainId: number;
}

/** A withdrawal request: the spend rules plus the allowlist and dual control. */
export function withdrawalGate(
  ctx: WithdrawalContext,
): { ok: true; needsApproval: boolean } | CustodyRefusal {
  const refused = standing(ctx, "request_withdrawal");
  if (refused) return refused;
  if (!ctx.destination || ctx.destination.status !== "verified") {
    return refuse(
      "destination_unverified",
      "Withdrawals go only to a verified custody destination.",
    );
  }
  if (ctx.destination.chainId !== ctx.chainId) {
    return refuse("destination_chain_mismatch", "The destination is on another chain.");
  }
  return { ok: true, needsApproval: ctx.usd >= ctx.institution.approvalThresholdUsd };
}
