/**
 * B9-005's execute leg: turn a triggered take-profit/stop into a real
 * close, signed by the USER'S AGENT WALLET (Circle DCW).
 *
 * Why the agent wallet: the server must never sign with a user's Privy
 * key (B8-007), so automation can only ever act on positions the agent
 * wallet itself holds. A strategy on a position held in the user's own
 * wallet still triggers and records what it wanted — the dashboard shows
 * it — but the close is theirs to click.
 *
 * The trade path is the shared `agentMarketTrade`, i.e. byte-identical to
 * the user's button. Sizing: the whole agent-held balance, clamped by the
 * strategy's own cap (a YES token redeems for at most 1 USDC, so capUsd
 * bounds tokens directly).
 */

import { eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { agentWallets } from "../../db/schema/index.ts";
import { events, markets } from "../../db/schema/index.ts";
import { SafetyError } from "../errors.ts";
import { logger } from "../logger.ts";
import { baseRpcClient } from "../rpc-client.ts";
import { parseAbi } from "viem";
import { checkSpendingCap } from "../spending-cap.ts";
import { agentMarketTrade } from "./market-agent-trade.ts";
import type { HedgeStrategy } from "../../db/schema/markets.ts";
import type { StrategyDecision } from "./strategies.ts";

const BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/**
 * USD magnitude of the close leg. YES tokens redeem for at most 1 USDC, so
 * the raw token amount bounds the leg's dollar value from above — the same
 * convention the strategy cap itself uses for sizing.
 */
export function closeLegUsd(amountRaw: bigint): number {
  return Number(amountRaw) / 1e6;
}

/**
 * Injectable seams for tests — defaults wire the real cap ledger, YES-token
 * balance read, and market-trade executor.
 */
export interface ExecuteCloseDeps {
  checkSpendingCap?: typeof checkSpendingCap;
  agentMarketTrade?: typeof agentMarketTrade;
  balanceOf?: (token: string, owner: string) => Promise<bigint>;
}

export type ExecuteOutcome =
  | {
      kind: "executed";
      txHash: string;
      soldRaw: string;
      usdcOutRaw: string;
      /** Circle tx id of the close (finalization ledger key). */
      circleTxId: string;
      /** "poll" = this call finalized (caller closes position); "webhook" =
       * the durable finalizer already closed + audited — do neither again. */
      finalizedBy: "poll" | "webhook";
    }
  | { kind: "held"; reason: string }
  | { kind: "failed"; error: string };

export async function executeTriggeredClose(
  db: DB,
  row: HedgeStrategy,
  decision: Extract<StrategyDecision, { kind: "trigger" }>,
  deps: ExecuteCloseDeps = {},
): Promise<ExecuteOutcome> {
  if (decision.action !== "close-position") {
    return { kind: "held", reason: "rebalance execution not yet supported" };
  }

  const marketRows = await db
    .select({
      yesToken: markets.yesToken,
      outcomeIndex: markets.outcomeIndex,
      providerEventId: events.providerEventId,
    })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .where(eq(markets.marketId, decision.marketId));
  const market = marketRows.at(0);
  if (!market?.yesToken) return { kind: "held", reason: "market row or yesToken missing" };

  const walletRows = await db
    .select({ circleWalletId: agentWallets.circleWalletId, address: agentWallets.address })
    .from(agentWallets)
    .where(eq(agentWallets.userId, row.userId))
    .limit(1);
  const wallet = walletRows.at(0);
  if (!wallet) return { kind: "held", reason: "no agent wallet provisioned" };

  const readBalance =
    deps.balanceOf ??
    ((token: string, owner: string) =>
      baseRpcClient.readContract({
        address: token as `0x${string}`,
        abi: BALANCE_ABI,
        functionName: "balanceOf",
        args: [owner as `0x${string}`],
      }));
  const balance = await readBalance(market.yesToken, wallet.address);
  if (balance === 0n) {
    return { kind: "held", reason: "agent wallet holds no position in this market" };
  }

  // YES ≤ 1 USDC each, so the strategy's USD cap bounds tokens directly.
  const capTokens = BigInt(Math.round(Number(row.capUsd) * 1e6));
  const amount = balance < capTokens ? balance : capTokens;

  // C-019 — the cron close moves money, so it honors the wallet's daily
  // spending cap like every other trade path. A capped-out wallet HOLDS
  // the close (no attempt counted on the strategy): the cron re-fires on
  // a later tick, and the cap resets at UTC midnight.
  const checkCap = deps.checkSpendingCap ?? checkSpendingCap;
  const executeTrade = deps.agentMarketTrade ?? agentMarketTrade;
  try {
    await checkCap(wallet.address, closeLegUsd(amount));
  } catch (err) {
    if (err instanceof SafetyError) {
      logger.warn(
        { strategyId: row.id, wallet: wallet.address, err },
        "strategy: close held by the daily spending cap",
      );
      return { kind: "held", reason: "daily spending cap reached — close retried on a later tick" };
    }
    throw err; // ledger outage is not a strategy decision — let the cron's error handling see it
  }

  try {
    const result = await executeTrade({
      walletId: wallet.circleWalletId,
      providerEventId: market.providerEventId,
      outcomeIndex: market.outcomeIndex === 0 ? 0 : 1,
      direction: "sell",
      amountRaw: amount,
      // C-015 — persist the pending close so the webhook finalizer can
      // resolve it if this poll times out (frozen lambda, network split).
      ledger: {
        kind: "strategy_close",
        userId: row.userId,
        walletAddress: wallet.address,
        circleWalletId: wallet.circleWalletId,
        payload: {
          strategyId: row.id,
          action: decision.action,
          marketId: decision.marketId,
        },
      },
    });
    logger.info(
      { strategyId: row.id, txHash: result.txHash, sold: amount.toString() },
      "strategy: position closed by agent wallet",
    );
    return {
      kind: "executed",
      txHash: result.txHash,
      soldRaw: amount.toString(),
      usdcOutRaw: result.quote.amountOut,
      circleTxId: result.circleTxId,
      finalizedBy: result.finalizedBy,
    };
  } catch (err) {
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
