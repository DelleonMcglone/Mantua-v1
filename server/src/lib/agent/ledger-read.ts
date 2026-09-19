import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { activity } from "../../db/schema/activity.ts";
import { logger } from "../logger.ts";
import { readMarketPositions } from "../sports/market-positions.ts";
import { buildLedger, type AgentLedger, type SimulationRow } from "./ledger.ts";
import { computeLedgerMetrics, type LedgerMetrics, type PositionMark } from "./ledger-metrics.ts";
import { readPerformanceInputs } from "./performance.ts";

/**
 * Task 070 / AE-011 — the production reader behind the public ledger:
 * fills, markets, resolutions and audit rows for the agent wallet
 * (`readPerformanceInputs`), the owner's simulations from the activity
 * timeline, and the live marks of open positions. The marks need the
 * chain; when that read fails the ledger still answers, with
 * `marksAvailable: false` and unrealised P&L reported as zero rather than
 * the whole page failing.
 */

export interface PublicLedger {
  ledger: AgentLedger;
  metrics: LedgerMetrics;
  marksAvailable: boolean;
  computedAt: string;
}

async function readSimulations(db: DB, userId: string): Promise<SimulationRow[]> {
  const rows = await db
    .select({
      id: activity.id,
      marketId: activity.marketId,
      valueUsd: activity.valueUsd,
      data: activity.data,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .where(and(eq(activity.userId, userId), eq(activity.kind, "agent_simulation")));
  return rows.map((r) => ({
    id: r.id,
    marketId: r.marketId,
    valueUsd: r.valueUsd === null ? null : Number(r.valueUsd),
    executable: (r.data as { executable?: unknown }).executable === true,
    createdAt: r.createdAt,
  }));
}

async function readMarks(address: string): Promise<{ marks: PositionMark[]; ok: boolean }> {
  try {
    const rows = await readMarketPositions(address as `0x${string}`);
    return {
      ok: true,
      marks: rows.map((r) => ({
        marketId: r.marketId,
        valueUsd: Number(r.valueRaw) / 1e6,
        pnlUsd: r.pnlRaw === null ? null : Number(r.pnlRaw) / 1e6,
      })),
    };
  } catch (err) {
    logger.warn({ err, address }, "ledger: position marks unavailable");
    return { ok: false, marks: [] };
  }
}

/** The ledger and its metrics for one agent wallet owned by `userId`. */
export async function readAgentLedger(
  db: DB,
  address: string,
  userId: string,
): Promise<PublicLedger> {
  const [inputs, simulations, marks] = await Promise.all([
    readPerformanceInputs(db, address),
    readSimulations(db, userId),
    readMarks(address),
  ]);
  const ledger = buildLedger(
    address,
    inputs.fills,
    inputs.marketRows,
    inputs.resolutionRows,
    inputs.auditByTx,
    simulations,
  );
  return {
    ledger,
    metrics: computeLedgerMetrics(ledger.markets, marks.marks),
    marksAvailable: marks.ok,
    computedAt: new Date().toISOString(),
  };
}
