import { inArray } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { markets } from "../../db/schema/index.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import { sharedCache } from "../shared-cache.ts";
import { MarketsNotDeployedError } from "../sports/market-trade-build.ts";
import { readComboOnChain, type ComboOnChain } from "./combo-market.ts";
import { winnersByMarket } from "./combo-read.ts";
import {
  comboOutcome,
  legResultFrom,
  type ComboVerdict,
  type LegResult,
} from "./combo-settlement.ts";
import { listCombosForUser, listOpenCombos, type ComboTicketRow } from "./combo-store.ts";

/**
 * Task 072 / CB-008 — tickets as the portfolio and the monitor see them:
 * the stored row, each leg's live result (the leg market's state and the
 * resolutions log, fresher than the stamp), the verdict, and the combo
 * pool's mark. No deployment → unmarked, never guessed.
 */

export const COMBO_MARK_CACHE_MS = 10_000;

export interface ComboLegView {
  marketId: string;
  providerEventId: string | null;
  outcomeIndex: 0 | 1;
  label: string;
  opponent: string | null;
  league: string | null;
  kickoffAt: number | null;
  result: LegResult;
  entryPriceBps: number | null;
}

export interface ComboTicketView {
  id: string;
  status: string;
  label: string;
  marketId: string;
  chainId: number;
  stakeRaw: string;
  sharesRaw: string;
  potentialPayoutRaw: string;
  entryPriceBps: number | null;
  combinedOdds: number | null;
  markBps: number | null;
  /** shares × mark, raw; null when unmarked. */
  valueRaw: string | null;
  pnlRaw: string | null;
  verdict: ComboVerdict;
  placedAt: string | null;
  settledAt: string | null;
  settlementPrice: number | null;
  redeemedAt: string | null;
  txHash: string | null;
  proceedsRaw: string | null;
  source: string;
  mode: string | null;
  legs: ComboLegView[];
}

/** The combo market's chain view, cached briefly; null when absent or undeployed. */
export async function cachedComboOnChain(
  marketId: string,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<ComboOnChain | null> {
  return sharedCache.getOrCompute(
    `combo-chain:${String(chainId)}:${marketId}`,
    COMBO_MARK_CACHE_MS,
    async () => {
      try {
        return await readComboOnChain(marketId as `0x${string}`, chainId);
      } catch (err) {
        if (err instanceof MarketsNotDeployedError) return null;
        throw err;
      }
    },
  );
}

/** Live leg results for a set of ticket rows, keyed by leg market id. */
export async function liveLegResults(
  db: DB,
  rows: readonly ComboTicketRow[],
): Promise<Map<string, LegResult>> {
  const ids = [...new Set(rows.flatMap((r) => r.legs.map((l) => l.marketId)))];
  const out = new Map<string, LegResult>();
  if (ids.length === 0) return out;
  const [states, winners] = await Promise.all([
    db
      .select({ marketId: markets.marketId, state: markets.state })
      .from(markets)
      .where(inArray(markets.marketId, ids)),
    winnersByMarket(db, ids),
  ]);
  for (const s of states)
    out.set(s.marketId, legResultFrom(s.state, winners.get(s.marketId) ?? null));
  return out;
}

/** Pure: a stored row + live results + mark → the view. A stamped result wins over a stale live read. */
export function ticketView(
  row: ComboTicketRow,
  live: ReadonlyMap<string, LegResult>,
  markBps: number | null,
): ComboTicketView {
  const legs: ComboLegView[] = row.legs.map((l) => ({
    marketId: l.marketId,
    providerEventId: l.providerEventId,
    outcomeIndex: l.outcomeIndex === 1 ? 1 : 0,
    label: l.label ?? l.marketId,
    opponent: l.opponent,
    league: l.league,
    kickoffAt: l.kickoffAt ? Math.floor(l.kickoffAt.getTime() / 1000) : null,
    result: l.result !== "pending" ? (l.result as LegResult) : (live.get(l.marketId) ?? "pending"),
    entryPriceBps: l.entryPrice === null ? null : Math.round(Number(l.entryPrice) * 10_000),
  }));
  const shares = BigInt(row.sharesRaw ?? "0");
  const stake = BigInt(row.stakeRaw ?? "0");
  const valueRaw = markBps === null ? null : (shares * BigInt(markBps)) / 10_000n;
  return {
    id: row.id,
    status: row.status,
    label: row.label ?? legs.map((l) => l.label).join(" + "),
    marketId: row.marketId ?? "",
    chainId: row.chainId,
    stakeRaw: stake.toString(),
    sharesRaw: shares.toString(),
    potentialPayoutRaw: row.potentialPayoutRaw ?? shares.toString(),
    entryPriceBps: row.entryPriceBps,
    combinedOdds: row.combinedOdds === null ? null : Number(row.combinedOdds),
    markBps,
    valueRaw: valueRaw === null ? null : valueRaw.toString(),
    pnlRaw: valueRaw === null ? null : (valueRaw - stake).toString(),
    verdict: comboOutcome(legs.map((l) => l.result)),
    placedAt: row.placedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    settlementPrice: row.settlementPrice === null ? null : Number(row.settlementPrice),
    redeemedAt: row.redeemedAt?.toISOString() ?? null,
    txHash: row.txHash,
    proceedsRaw: row.proceedsRaw,
    source: row.source,
    mode: row.mode,
    legs,
  };
}

async function viewsFor(
  db: DB,
  rows: ComboTicketRow[],
  markLive: boolean,
): Promise<ComboTicketView[]> {
  const live = await liveLegResults(db, rows);
  const marks = new Map<string, number | null>();
  for (const row of rows) {
    if (!row.marketId || marks.has(row.marketId)) continue;
    const open = row.status === "open" || row.status === "dead";
    marks.set(
      row.marketId,
      markLive && open ? ((await cachedComboOnChain(row.marketId))?.markBps ?? null) : null,
    );
  }
  return rows.map((r) => ticketView(r, live, r.marketId ? (marks.get(r.marketId) ?? null) : null));
}

export async function readComboTickets(db: DB, userId: string): Promise<ComboTicketView[]> {
  return viewsFor(db, await listCombosForUser(db, userId), true);
}

/** Every live ticket, marked — the monitor's input. */
export async function readOpenComboTickets(
  db: DB,
): Promise<{ row: ComboTicketRow; view: ComboTicketView }[]> {
  const rows = await listOpenCombos(db);
  const views = await viewsFor(db, rows, true);
  return rows.map((row, i) => ({ row, view: views[i] }));
}
