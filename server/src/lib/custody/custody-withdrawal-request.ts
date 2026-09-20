import { and, eq } from "drizzle-orm";
import { parseUnits } from "viem";
import type { DB } from "../../db/client.ts";
import { agentWallets } from "../../db/schema/agent.ts";
import {
  custodyDestinations,
  custodyWithdrawals,
  type CustodyWithdrawal,
} from "../../db/schema/institutions.ts";
import { circleBlockchainFor } from "../agent-wallet-create.ts";
import type { SupportedChainId } from "../chains.ts";
import { SafetyError } from "../errors.ts";
import { checkSpendingCap } from "../spending-cap.ts";
import { getToken, type TokenSymbol } from "../tokens.ts";
import { tokenAmountUsdStrict } from "../usd-pricing.ts";
import { withdrawalGate, type CustodyRefusalCode } from "./custody-policy.ts";
import { institutionSpentToday, limitsOf, membershipForUser, memberView } from "./custody-store.ts";
import {
  executeWithdrawal,
  type AuditContext,
  type ExecuteResult,
} from "./custody-withdrawal-exec.ts";

/**
 * Task 074 / IC-001 — requesting a withdrawal. The request is gated
 * (standing, segregation, caps, a verified destination on the right
 * chain); below the threshold it is approved by the rule and executed at
 * once, at or above it it waits for a second member (`custody-withdrawals.ts`).
 * Requests expire after a day.
 */

export const WITHDRAWAL_TTL_MS = 24 * 60 * 60 * 1000;

export type RequestResult =
  | { kind: "not_member" }
  | { kind: "no_wallet" }
  | { kind: "no_destination" }
  | { kind: "refused"; code: CustodyRefusalCode | "bad_amount" | "wallet_cap"; message: string }
  | { kind: "pending"; withdrawal: CustodyWithdrawal }
  | ExecuteResult;

export async function requestWithdrawal(
  db: DB,
  input: {
    userId: string;
    privyUserId: string;
    destinationId: string;
    symbol: TokenSymbol;
    amount: string;
    chainId: SupportedChainId;
    audit: AuditContext;
  },
): Promise<RequestResult> {
  const m = await membershipForUser(db, input.userId);
  if (!m) return { kind: "not_member" };
  const wallet = (
    await db
      .select()
      .from(agentWallets)
      .where(
        and(
          eq(agentWallets.userId, input.userId),
          eq(agentWallets.blockchain, circleBlockchainFor(input.chainId)),
        ),
      )
      .limit(1)
  ).at(0);
  if (!wallet) return { kind: "no_wallet" };
  const dest = (
    await db
      .select()
      .from(custodyDestinations)
      .where(
        and(
          eq(custodyDestinations.id, input.destinationId),
          eq(custodyDestinations.institutionId, m.institution.id),
        ),
      )
      .limit(1)
  ).at(0);
  if (!dest) return { kind: "no_destination" };
  const raw = parseUnits(input.amount, getToken(input.symbol, input.chainId).decimals);
  if (raw <= 0n) return { kind: "refused", code: "bad_amount", message: "amount must be positive" };
  const usd = await tokenAmountUsdStrict(input.symbol, raw);
  const verdict = withdrawalGate({
    institution: limitsOf(m.institution),
    member: memberView(m.member),
    walletSetId: wallet.walletSetId,
    usd,
    spentTodayUsd: await institutionSpentToday(db, m.institution.id),
    destination: { status: dest.status, chainId: dest.chainId },
    chainId: input.chainId,
  });
  if (!verdict.ok) return { kind: "refused", code: verdict.code, message: verdict.message };
  // The wallet's own daily cap (and the hard ceiling) bind at execution;
  // refusing here spares a second member approving a send that cannot go.
  try {
    await checkSpendingCap(wallet.address, usd);
  } catch (err) {
    if (err instanceof SafetyError)
      return { kind: "refused", code: "wallet_cap", message: err.message };
    throw err;
  }
  const row = (
    await db
      .insert(custodyWithdrawals)
      .values({
        institutionId: m.institution.id,
        requestedBy: input.userId,
        walletAddress: wallet.address,
        destinationId: dest.id,
        symbol: input.symbol,
        amount: input.amount,
        usdValue: usd.toFixed(2),
        status: verdict.needsApproval ? "pending" : "approved",
        reason: verdict.needsApproval ? null : "below_threshold",
        expiresAt: new Date(Date.now() + WITHDRAWAL_TTL_MS),
      })
      .returning()
  )[0];
  if (verdict.needsApproval) return { kind: "pending", withdrawal: row };
  return executeWithdrawal(db, row, dest, input.privyUserId, input.audit);
}
