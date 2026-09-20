import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import type { AgentWallet } from "../../db/schema/agent.ts";
import { custodyDestinations, custodyWithdrawals } from "../../db/schema/institutions.ts";
import { SafetyError } from "../errors.ts";
import { spendGate } from "./custody-policy.ts";
import {
  institutionSpentToday,
  limitsOf,
  membershipForWallet,
  memberView,
} from "./custody-store.ts";

/**
 * Task 074 / IC-001 — the custody rules at the two choke points that
 * already carry every money path. `assertCustodySpend` runs inside
 * `checkSpendingCap` (trades, combos, hedges, sends, gateway); `assertCustodySend`
 * runs inside `sendFromAgentWallet`, the only agent send. Both are no-ops
 * for a wallet that belongs to no institution, so retail is untouched.
 */

export async function assertCustodySpend(address: string, usd: number): Promise<void> {
  const m = await membershipForWallet(db, address);
  if (!m) return;
  const verdict = spendGate({
    institution: limitsOf(m.institution),
    member: memberView(m.member),
    walletSetId: m.wallet.walletSetId,
    usd,
    spentTodayUsd: await institutionSpentToday(db, m.institution.id),
  });
  if (!verdict.ok) {
    throw new SafetyError("custody_refused", verdict.message, {
      reason: verdict.code,
      institutionId: m.institution.id,
    });
  }
}

/**
 * A send from an institutional wallet must be an approved custody
 * withdrawal in its `executing` claim, for this wallet, to its verified
 * destination, of exactly this token and amount. Anything else — the
 * agent's chat send, a route without a withdrawal — is refused.
 */
export async function assertCustodySend(
  wallet: AgentWallet,
  args: { to: string; symbol: string; amount: string; withdrawalId?: string | undefined },
): Promise<void> {
  const m = await membershipForWallet(db, wallet.address);
  if (!m) return;
  const details = { institutionId: m.institution.id, withdrawalId: args.withdrawalId ?? null };
  if (!args.withdrawalId) {
    throw new SafetyError(
      "custody_withdrawal_required",
      "Sends from an institutional wallet go through a custody withdrawal to a verified destination.",
      details,
    );
  }
  const row = (
    await db
      .select({ w: custodyWithdrawals, d: custodyDestinations })
      .from(custodyWithdrawals)
      .innerJoin(custodyDestinations, eq(custodyDestinations.id, custodyWithdrawals.destinationId))
      .where(eq(custodyWithdrawals.id, args.withdrawalId))
      .limit(1)
  ).at(0);
  const bound =
    row !== undefined &&
    row.w.institutionId === m.institution.id &&
    row.w.walletAddress === wallet.address &&
    row.w.status === "executing" &&
    row.d.status === "verified" &&
    row.d.address.toLowerCase() === args.to.toLowerCase() &&
    row.w.symbol === args.symbol &&
    row.w.amount === args.amount;
  if (!bound) {
    throw new SafetyError(
      "custody_withdrawal_required",
      "The custody withdrawal does not match this send.",
      details,
    );
  }
}
