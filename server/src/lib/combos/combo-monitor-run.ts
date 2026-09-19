import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { activity } from "../../db/schema/activity.ts";
import { recordActivity } from "../activity.ts";
import { readPolicy, type AgentPolicyView } from "../agent/policy.ts";
import type { AgentMode } from "../agent/agent-mode.ts";
import type { SupportedChainId } from "../chains.ts";
import { logger } from "../logger.ts";
import { checkSpendingCap } from "../spending-cap.ts";
import { agentMarketTrade } from "../sports/market-agent-trade.ts";
import { agentComboTrade, agentWalletForUser } from "./combo-agent-trade.ts";
import {
  describeAction,
  planComboManagement,
  type ComboAction,
  type MonitoredLeg,
} from "./combo-monitor.ts";
import { latestPricesBps, readLegRows, winnersByMarket } from "./combo-read.ts";
import { markComboDead } from "./combo-stamps.ts";
import type { ComboTicketRow } from "./combo-store.ts";
import { recordComboFill } from "./combo-fill.ts";
import { readOpenComboTickets, type ComboTicketView } from "./combo-tickets.ts";
import { legResults } from "./combo-trade.ts";

/**
 * Task 072 / CB-009 — the monitor tick. Every open ticket is planned by
 * `planComboManagement`; an action executes only for a ticket the agent
 * built, under a policy with `autoManage`, in autonomous mode, from the
 * user's agent wallet — every other case becomes one recommendation on
 * the timeline (and a push), never repeated for the same ticket and
 * action on the same day. Money paths here are the agent's own: the daily
 * cap is checked before a hedge buys, the spend and the close are inked
 * by whoever wins the C-015 finalization claim, exactly once.
 */

export interface MonitorDeps {
  mode: AgentMode;
  chainId: SupportedChainId;
  nowMs: number;
  sellCombo?: typeof agentComboTrade;
  hedgeLeg?: typeof agentMarketTrade;
}

export interface MonitorOutcome {
  comboId: string;
  action: ComboAction["kind"];
  disposition: "held" | "stamped" | "executed" | "recommended" | "already_recommended" | "failed";
  detail: string;
}

const dayKey = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

async function recommend(
  db: DB,
  t: ComboTicketView,
  row: ComboTicketRow,
  action: ComboAction,
  nowMs: number,
) {
  const refId = `combo:${t.id}:${action.kind}:${dayKey(nowMs)}`;
  const seen = await db
    .select({ id: activity.id })
    .from(activity)
    .where(and(eq(activity.refId, refId), eq(activity.kind, "agent_recommendation")))
    .limit(1);
  if (seen.length > 0) return "already_recommended" as const;
  await recordActivity(db, {
    kind: "agent_recommendation",
    actor: "agent",
    userId: row.userId,
    walletAddress: row.walletAddress,
    marketId: row.marketId,
    positionRef: t.id,
    refId,
    asset: t.label,
    summary: `Combo ${t.label}: ${describeAction(action)}`,
    data: { action: action.kind, reason: describeAction(action) },
  });
  return "recommended" as const;
}

async function execute(
  db: DB,
  t: ComboTicketView,
  row: ComboTicketRow,
  action: ComboAction,
  deps: MonitorDeps,
) {
  const wallet = await agentWalletForUser(db, row.userId, deps.chainId);
  if (!wallet) throw new Error("no agent wallet on this chain");
  const legRows = await readLegRows(
    db,
    t.legs
      .filter((l) => l.providerEventId)
      .map((l) => ({ providerEventId: l.providerEventId as string, outcomeIndex: l.outcomeIndex })),
    deps.chainId,
  );
  const legs = legResults(
    legRows,
    await winnersByMarket(
      db,
      legRows.map((r) => r.marketId),
    ),
  );
  if (action.kind === "take_profit") {
    const r = await (deps.sellCombo ?? agentComboTrade)({
      walletId: wallet.circleWalletId,
      walletAddress: wallet.address,
      userId: row.userId,
      comboId: t.id,
      trade: {
        marketId: t.marketId as `0x${string}`,
        direction: "sell",
        amountRaw: BigInt(t.sharesRaw),
        chainId: deps.chainId,
        legs,
        nowMs: deps.nowMs,
      },
    });
    if (r.finalizedBy === "poll") {
      await recordComboFill(db, {
        userId: row.userId,
        walletAddress: wallet.address,
        chainId: deps.chainId,
        marketId: t.marketId as `0x${string}`,
        direction: "sell",
        tokensRaw: BigInt(t.sharesRaw),
        usdcRaw: BigInt(r.quote.amountOut),
        txHash: r.txHash,
        legs: [],
        source: "agent",
        mode: "autonomous",
      });
    }
    return `sold for ${(Number(r.quote.amountOut) / 1e6).toFixed(2)} USDC (${r.txHash})`;
  }
  if (action.kind === "hedge_leg") {
    const usd = Number(action.amountRaw) / 1e6;
    await checkSpendingCap(wallet.address, usd);
    const r = await (deps.hedgeLeg ?? agentMarketTrade)({
      walletId: wallet.circleWalletId,
      providerEventId: action.leg.providerEventId,
      outcomeIndex: action.hedgeOutcomeIndex,
      direction: "buy",
      amountRaw: action.amountRaw,
      chainId: deps.chainId,
      ledger: {
        kind: "combo_trade",
        userId: row.userId,
        walletAddress: wallet.address,
        payload: {
          comboId: t.id,
          userId: row.userId,
          marketId: "",
          direction: "buy",
          amountRaw: action.amountRaw.toString(),
          expectedOutRaw: "0",
          agentAddress: wallet.address,
          hedge: true,
        },
      },
    });
    await recordActivity(db, {
      kind: "hedge",
      actor: "agent",
      userId: row.userId,
      walletAddress: wallet.address,
      txHash: r.txHash,
      chainId: deps.chainId,
      marketId: r.marketId,
      positionRef: t.id,
      asset: `${action.leg.teamName} hedge`,
      amountRaw: r.quote.amountOut,
      valueUsd: usd,
      data: { action: "hedge_leg", comboId: t.id, finalizedBy: r.finalizedBy },
    });
    return `hedged ${action.leg.teamName} for ${usd.toFixed(2)} USDC (${r.txHash})`;
  }
  return "nothing to execute";
}

export async function runComboMonitor(db: DB, deps: MonitorDeps): Promise<MonitorOutcome[]> {
  const out: MonitorOutcome[] = [];
  const tickets = (await readOpenComboTickets(db)).filter((t) => t.row.chainId === deps.chainId);
  const prices = await latestPricesBps(db, [
    ...new Set(tickets.flatMap((t) => t.view.legs.map((l) => l.marketId))),
  ]);
  const policies = new Map<string, AgentPolicyView>();
  for (const { row, view } of tickets) {
    try {
      const policy = policies.get(row.userId) ?? (await readPolicy(db, row.userId));
      policies.set(row.userId, policy);
      const legs: MonitoredLeg[] = view.legs.map((l) => ({
        marketId: l.marketId as `0x${string}`,
        providerEventId: l.providerEventId ?? "",
        outcomeIndex: l.outcomeIndex,
        teamName: l.label,
        result: l.result,
        priceBps: prices.get(l.marketId) ?? null,
      }));
      const action = planComboManagement(
        {
          comboId: view.id,
          status: view.status,
          stakeRaw: BigInt(view.stakeRaw),
          markBps: view.markBps,
          legs,
        },
        { takeProfitBps: policy.combo.takeProfitBps },
      );
      if (action.kind === "hold") {
        out.push({ comboId: view.id, action: "hold", disposition: "held", detail: action.reason });
      } else if (action.kind === "mark_dead") {
        const changed = await markComboDead(db, row.id);
        out.push({
          comboId: view.id,
          action: "mark_dead",
          disposition: changed ? await recommend(db, view, row, action, deps.nowMs) : "held",
          detail: action.reason,
        });
      } else if (
        row.source === "agent" &&
        policy.combo.autoManage &&
        policy.status === "active" &&
        deps.mode === "autonomous"
      ) {
        out.push({
          comboId: view.id,
          action: action.kind,
          disposition: "executed",
          detail: await execute(db, view, row, action, deps),
        });
      } else {
        out.push({
          comboId: view.id,
          action: action.kind,
          disposition: await recommend(db, view, row, action, deps.nowMs),
          detail: describeAction(action),
        });
      }
    } catch (err) {
      logger.error({ err, comboId: row.id }, "combos: monitor failed for a ticket");
      out.push({
        comboId: row.id,
        action: "hold",
        disposition: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
