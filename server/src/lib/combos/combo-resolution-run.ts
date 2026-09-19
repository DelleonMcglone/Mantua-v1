import type { DB } from "../../db/client.ts";
import { recordActivity } from "../activity.ts";
import { logAudit } from "../audit.ts";
import type { SupportedChainId } from "../chains.ts";
import { logger } from "../logger.ts";
import { authorizeComboResolution } from "../sports/resolution-criteria.ts";
import type { ResolutionSubmitter } from "../sports/resolution.ts";
import {
  comboOutcome,
  planComboResolution,
  type ComboResolutionAction,
  type LegResult,
} from "./combo-settlement.ts";
import { markComboDead, settleCombo, stampLegResults } from "./combo-stamps.ts";
import type { ComboTicketRow } from "./combo-store.ts";
import { cachedComboOnChain, liveLegResults, readOpenComboTickets } from "./combo-tickets.ts";

/**
 * Task 072 / CB-007 — the combo settlement pass, run by the resolution
 * cron after the leg markets. Per ticket: stamp leg results, mark dead on
 * a lost leg; per combo market: freeze then resolve/void through the
 * resolver from the conjunction rule, with the combo authorization mint;
 * per ticket on a resolved market: the settlement stamp and its timeline
 * entry. Without a submitter (no signer) the stamps still land and the
 * on-chain actions are reported as the dry-run plan.
 */

export interface ComboSettlementSummary {
  tickets: number;
  legsStamped: number;
  markedDead: number;
  planned: ComboResolutionAction[];
  frozen: number;
  resolved: number;
  voided: number;
  settled: number;
  failures: { marketId: string; error: string }[];
}

const SETTLEMENT_PRICE = { won: "1.00000", lost: "0.00000", void: "0.50000" } as const;

function legsOf(row: ComboTicketRow, live: ReadonlyMap<string, LegResult>) {
  return row.legs.map((l) => ({
    marketId: l.marketId,
    result: l.result !== "pending" ? (l.result as LegResult) : (live.get(l.marketId) ?? "pending"),
  }));
}

async function settleTicket(
  db: DB,
  row: ComboTicketRow,
  kind: "won" | "lost" | "void",
): Promise<boolean> {
  const done = await settleCombo(db, row.id, kind, SETTLEMENT_PRICE[kind]);
  if (!done) return false;
  const shares = Number(row.sharesRaw ?? 0) / 1e6;
  const value = kind === "won" ? shares : kind === "void" ? shares / 2 : 0;
  await recordActivity(db, {
    kind: "combo_settle",
    actor: "system",
    userId: row.userId,
    walletAddress: row.walletAddress,
    chainId: row.chainId,
    marketId: row.marketId,
    positionRef: row.id,
    asset: row.label,
    amountRaw: row.sharesRaw?.toString() ?? null,
    valueUsd: value,
    data: { outcome: kind, settlementPrice: Number(SETTLEMENT_PRICE[kind]) },
  });
  return true;
}

export async function runComboSettlement(
  db: DB,
  chainId: SupportedChainId,
  nowSeconds: number,
  submitter: ResolutionSubmitter | null,
): Promise<ComboSettlementSummary> {
  const summary: ComboSettlementSummary = {
    tickets: 0,
    legsStamped: 0,
    markedDead: 0,
    planned: [],
    frozen: 0,
    resolved: 0,
    voided: 0,
    settled: 0,
    failures: [],
  };
  const tickets = (await readOpenComboTickets(db))
    .map((t) => t.row)
    .filter((r) => r.chainId === chainId);
  summary.tickets = tickets.length;
  if (tickets.length === 0) return summary;
  const live = await liveLegResults(db, tickets);

  // 1. Stamp what the legs say; a lost leg kills the ticket now.
  const byMarket = new Map<string, { rows: ComboTicketRow[]; results: LegResult[] }>();
  for (const row of tickets) {
    const legs = legsOf(row, live);
    summary.legsStamped += await stampLegResults(db, row.id, legs);
    const results = legs.map((l) => l.result);
    if (comboOutcome(results).kind === "lost" && (await markComboDead(db, row.id)))
      summary.markedDead += 1;
    if (!row.marketId) continue;
    const group = byMarket.get(row.marketId) ?? { rows: [], results };
    group.rows.push(row);
    byMarket.set(row.marketId, group);
  }

  // 2. Per combo market: the on-chain plan, executed through the resolver.
  for (const [marketId, group] of byMarket) {
    const first = group.rows[0];
    const onChain = await cachedComboOnChain(marketId, chainId);
    const state = onChain?.state ?? "OPEN";
    const verdict = comboOutcome(group.results);
    const startsAt = first.startsAt ? Math.floor(first.startsAt.getTime() / 1000) : nowSeconds;
    const plan = planComboResolution(
      [
        {
          comboMarketId: marketId as `0x${string}`,
          startsAt,
          marketState: state,
          legResults: group.results,
        },
      ],
      nowSeconds,
    );
    summary.planned.push(...plan);
    let settledState = state === "RESOLVED" || state === "SETTLED" || state === "INVALID";
    if (submitter && plan.length > 0) {
      try {
        for (const action of plan)
          await submitAction(submitter, action, group, nowSeconds, chainId, summary);
        settledState = plan.some((a) => a.kind !== "freeze");
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        summary.failures.push({ marketId, error });
        logger.error({ marketId, err }, "combos: settlement action failed");
      }
    }
    // 3. Tickets on a resolved market settle by the same rule that resolved it.
    if (settledState && verdict.kind !== "pending") {
      for (const row of group.rows)
        if (await settleTicket(db, row, verdict.kind)) summary.settled += 1;
    }
  }
  return summary;
}

async function submitAction(
  submitter: ResolutionSubmitter,
  action: ComboResolutionAction,
  group: { rows: ComboTicketRow[]; results: LegResult[] },
  nowSeconds: number,
  chainId: SupportedChainId,
  summary: ComboSettlementSummary,
): Promise<void> {
  const legs = (group.rows[0]?.legs ?? []).map((l, i) => ({
    marketId: l.marketId,
    result: group.results[i] ?? "pending",
  }));
  let txHash: string | null;
  if (action.kind === "freeze") {
    txHash = await submitter.freeze(action.comboMarketId);
    summary.frozen += 1;
  } else if (action.kind === "void") {
    txHash = await submitter.void(action.comboMarketId);
    summary.voided += 1;
  } else {
    txHash = await submitter.resolve(
      authorizeComboResolution({ marketId: action.comboMarketId, legs, nowSeconds }),
    );
    summary.resolved += 1;
  }
  await logAudit({
    action: "combo_resolve",
    outcome: "success",
    chainId,
    txHash: txHash ?? undefined,
    params: {
      marketId: action.comboMarketId,
      kind: action.kind,
      outcome: action.outcome ?? null,
      legs,
      signer: submitter.signerAddress(),
    },
  });
}
