import { and, eq, gte, inArray, lt, lte, ne } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { DB } from "../../db/client.ts";
import { circleExecutions } from "../../db/schema/circle.ts";
import { custodyDestinations, custodyWithdrawals } from "../../db/schema/institutions.ts";
import { marketFills } from "../../db/schema/markets.ts";
import { dailyWalletSpend, mantuaAuditLog, type MantuaAuditLog } from "../../db/schema/safety.ts";
import { portfolioTransactions } from "../../db/schema/trading.ts";
import { buildStatement, csvCell, type Statement } from "./custody-statement.ts";
import {
  executionRow,
  fillRow,
  portfolioRow,
  spendRow,
  withdrawalRow,
} from "./custody-statement-rows.ts";
import { institutionWallets } from "./custody-store.ts";

/**
 * Task 073 / IC-002 — reporting over every member wallet of the
 * institution for a period [from, to): the fills, the confirmed portfolio
 * transactions, the Circle executions that did not confirm, the custody
 * withdrawals and the daily spend ledger, as one statement; and the audit
 * trail as the compliance record.
 */

export async function institutionStatement(
  db: DB,
  institutionId: string,
  from: Date,
  to: Date,
): Promise<Statement> {
  const wallets = (await institutionWallets(db, institutionId)).map((w) => w.address);
  if (wallets.length === 0) return buildStatement({ from, to, wallets, rows: [] });
  const inPeriod = (col: PgColumn) => and(gte(col, from), lt(col, to));
  const [fills, portfolio, executions, withdrawals, spend] = await Promise.all([
    db
      .select()
      .from(marketFills)
      .where(and(inArray(marketFills.address, wallets), inPeriod(marketFills.createdAt))),
    db
      .select()
      .from(portfolioTransactions)
      .where(
        and(
          inArray(portfolioTransactions.walletAddress, wallets),
          inPeriod(portfolioTransactions.createdAt),
        ),
      ),
    db
      .select()
      .from(circleExecutions)
      .where(
        and(
          inArray(circleExecutions.walletAddress, wallets),
          ne(circleExecutions.status, "confirmed"),
          inPeriod(circleExecutions.createdAt),
        ),
      ),
    db
      .select({ w: custodyWithdrawals, label: custodyDestinations.label })
      .from(custodyWithdrawals)
      .innerJoin(custodyDestinations, eq(custodyDestinations.id, custodyWithdrawals.destinationId))
      .where(
        and(
          eq(custodyWithdrawals.institutionId, institutionId),
          inPeriod(custodyWithdrawals.createdAt),
        ),
      ),
    db
      .select()
      .from(dailyWalletSpend)
      .where(
        and(
          inArray(dailyWalletSpend.walletAddress, wallets),
          gte(dailyWalletSpend.spendDate, from.toISOString().slice(0, 10)),
          // The ledger is per UTC day: the day `to` falls in is part of
          // [from, to) unless `to` is exactly midnight.
          lte(dailyWalletSpend.spendDate, new Date(to.getTime() - 1).toISOString().slice(0, 10)),
        ),
      ),
  ]);
  return buildStatement({
    from,
    to,
    wallets,
    rows: [
      ...fills.map(fillRow),
      ...portfolio.map(portfolioRow),
      ...executions.map(executionRow),
      ...withdrawals.map((r) => withdrawalRow(r.w, r.label)),
      ...spend.map(spendRow),
    ],
  });
}

/** The audit trail for the institution's wallets in the period. */
export async function institutionAuditRows(
  db: DB,
  institutionId: string,
  from: Date,
  to: Date,
): Promise<MantuaAuditLog[]> {
  const wallets = (await institutionWallets(db, institutionId)).map((w) => w.address);
  if (wallets.length === 0) return [];
  return db
    .select()
    .from(mantuaAuditLog)
    .where(
      and(
        inArray(mantuaAuditLog.walletAddress, wallets),
        gte(mantuaAuditLog.createdAt, from),
        lt(mantuaAuditLog.createdAt, to),
      ),
    )
    .orderBy(mantuaAuditLog.createdAt);
}

export const AUDIT_COLUMNS = ["at", "wallet", "action", "outcome", "tx_hash", "reason"] as const;

export function auditCsv(rows: MantuaAuditLog[]): string {
  const lines = [AUDIT_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.createdAt.toISOString(), r.walletAddress, r.action, r.outcome, r.txHash, r.reason]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}
