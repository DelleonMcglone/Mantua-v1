import { db } from "../db/client.ts";
import { type AuditAction, type AuditOutcome, mantuaAuditLog } from "../db/schema/safety.ts";
import { ACTIVE_CHAIN_ID } from "./constants.ts";
import { logger } from "./logger.ts";

export interface AuditEntry {
  walletAddress?: string | undefined;
  action: AuditAction;
  outcome: AuditOutcome;
  params?: Record<string, unknown> | undefined;
  txHash?: string | undefined;
  chainId?: number | undefined;
  reason?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * P1-008 — log a mainnet write attempt. Logs to both Postgres and pino.
 * Database failures are caught and re-logged so a missed audit row never
 * cascades into a failed user request — but they ARE logged at error level
 * so they're visible in observability.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const row = {
    walletAddress: entry.walletAddress?.toLowerCase() ?? null,
    action: entry.action,
    outcome: entry.outcome,
    params: entry.params ?? {},
    txHash: entry.txHash ?? null,
    chainId: entry.chainId ?? ACTIVE_CHAIN_ID,
    reason: entry.reason ?? null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  };

  logger.info({ audit: row }, "audit");

  try {
    await db.insert(mantuaAuditLog).values(row);
  } catch (err) {
    logger.error({ err, audit: row }, "audit log insert failed");
  }
}
