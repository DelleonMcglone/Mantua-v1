import { and, eq, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { DB } from "../../db/client.ts";
import {
  custodyWithdrawals,
  type CustodyDestination,
  type CustodyWithdrawal,
} from "../../db/schema/institutions.ts";
import { sendFromAgentWallet } from "../agent-send.ts";
import { logAudit } from "../audit.ts";
import { isSupportedChainId } from "../chains.ts";
import { CircleReceiptTimeoutError } from "../circle/execute.ts";
import { isTokenSymbol } from "../tokens.ts";

/**
 * Task 073 / IC-001 — executing an approved withdrawal. One conditional
 * claim (approved → executing) so a double click or a webhook race can
 * never send twice; then the same `sendFromAgentWallet` every agent send
 * uses, which the custody gate admits only for this exact claim. A
 * receipt timeout leaves the row `executing` with the error — the send may
 * still land, so it is never retried by this path.
 */

export type ExecuteResult =
  | { kind: "executed"; withdrawal: CustodyWithdrawal; txHash: string }
  | { kind: "pending_receipt"; withdrawal: CustodyWithdrawal }
  | { kind: "failed"; withdrawal: CustodyWithdrawal; error: string }
  | { kind: "not_claimable" };

export interface AuditContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export async function executeWithdrawal(
  db: DB,
  row: CustodyWithdrawal,
  destination: CustodyDestination,
  requesterPrivyUserId: string,
  audit: AuditContext,
): Promise<ExecuteResult> {
  const claimed = (
    await db
      .update(custodyWithdrawals)
      .set({ status: "executing", updatedAt: sql`now()` })
      .where(and(eq(custodyWithdrawals.id, row.id), eq(custodyWithdrawals.status, "approved")))
      .returning()
  ).at(0);
  if (!claimed) return { kind: "not_claimable" };
  const chainId = destination.chainId;
  const stamp = async (patch: Partial<typeof custodyWithdrawals.$inferInsert>) =>
    (
      await db
        .update(custodyWithdrawals)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(custodyWithdrawals.id, row.id))
        .returning()
    )[0];
  const auditBase = {
    walletAddress: row.walletAddress,
    action: "custody_withdrawal" as const,
    params: { withdrawalId: row.id, destination: destination.address, amount: row.amount },
    ...audit,
  };
  if (!isTokenSymbol(row.symbol) || !isSupportedChainId(chainId)) {
    const failed = await stamp({ status: "failed", lastError: "unsupported token or chain" });
    return { kind: "failed", withdrawal: failed, error: "unsupported token or chain" };
  }
  try {
    const result = await sendFromAgentWallet({
      privyUserId: requesterPrivyUserId,
      to: destination.address as Address,
      symbol: row.symbol,
      amount: row.amount,
      chainId,
      auditContext: {
        ...(audit.ipAddress ? { ipAddress: audit.ipAddress } : {}),
        ...(audit.userAgent ? { userAgent: audit.userAgent } : {}),
      },
      custodyWithdrawalId: row.id,
    });
    const executed = await stamp({ status: "executed", txHash: result.txHash });
    await logAudit({ ...auditBase, outcome: "success", txHash: result.txHash });
    return { kind: "executed", withdrawal: executed, txHash: result.txHash };
  } catch (err) {
    if (err instanceof CircleReceiptTimeoutError) {
      const pending = await stamp({ lastError: "receipt pending", txHash: err.txHash });
      await logAudit({ ...auditBase, outcome: "pending", reason: "receipt pending" });
      return { kind: "pending_receipt", withdrawal: pending };
    }
    const message = err instanceof Error ? err.message : String(err);
    const failed = await stamp({ status: "failed", lastError: message });
    await logAudit({ ...auditBase, outcome: "failure", reason: message });
    return { kind: "failed", withdrawal: failed, error: message };
  }
}
