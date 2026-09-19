import type { DB } from "../../db/client.ts";
import { listActivity } from "../activity.ts";
import { agentModeFromEnv } from "../agent-chat.ts";
import { readPolicy } from "../agent/policy.ts";
import { summarizeMarketPositions, type PositionsSummary } from "../agent/read-tools.ts";
import { getAgentWallet } from "../agent-wallet.ts";
import { DEFAULT_CHAIN_ID } from "../chains.ts";
import { dbFiatStore } from "../fiat-store.ts";
import { logger } from "../logger.ts";
import { readMarketPositions } from "../sports/market-positions.ts";
import { resolveUserId } from "../sports/strategy-store.ts";
import type { TroubleshootContext } from "./troubleshoot.ts";

/**
 * Task 070 / AE-008 — the signed-in user's own account, shaped for the
 * support agent: recent activity, fiat transfers, marked positions and
 * the agent's standing. Only ever the caller's records — there is no
 * lookup by address or user id from the conversation. Each block is
 * best-effort so one failing read (the chain, most often) does not empty
 * the rest.
 */

export interface AccountContext {
  /** Internal user id, for the ticket a conversation may open. */
  userId: string;
  activity: {
    kind: string;
    status: string;
    actor: string;
    summary: string;
    valueUsd: number | null;
    txHash: string | null;
    at: string;
  }[];
  transfers: {
    kind: string;
    status: string;
    amountUsd: number;
    failureReason: string | null;
    recoveryAction: string | null;
    at: string;
  }[];
  positions: PositionsSummary | null;
  agent: {
    hasWallet: boolean;
    dailyCapUsd: number | null;
    mode: string;
    policy: { status: string; autoTradeEnabled: boolean; maxStakePerTradeUsd: number } | null;
  };
  troubleshoot: NonNullable<TroubleshootContext["account"]>;
}

const ACTIVITY_LIMIT = 15;
const TRANSFER_LIMIT = 10;

async function best<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    logger.warn({ err, label }, "support: account read failed");
    return fallback;
  }
}

export async function readAccountContext(
  db: DB,
  privyUserId: string,
  walletAddress: string | undefined,
): Promise<AccountContext | null> {
  const userId = await resolveUserId(db, privyUserId);
  if (!userId) return null;
  const [activity, transfers, positions, wallet, policy] = await Promise.all([
    best(
      "activity",
      () =>
        listActivity(db, {
          userId,
          walletAddresses: walletAddress ? [walletAddress] : [],
          limit: ACTIVITY_LIMIT,
        }),
      [],
    ),
    best("transfers", () => dbFiatStore.listTransfers(userId, TRANSFER_LIMIT), []),
    best(
      "positions",
      async () =>
        walletAddress
          ? summarizeMarketPositions(await readMarketPositions(walletAddress as `0x${string}`))
          : null,
      null,
    ),
    best("agent wallet", () => getAgentWallet(privyUserId, DEFAULT_CHAIN_ID), null),
    best("policy", () => readPolicy(db, userId), null),
  ]);
  const lastFailed = transfers.find((t) => t.status === "failed");
  return {
    userId,
    activity: activity.map((a) => ({
      kind: a.kind,
      status: a.status,
      actor: a.actor,
      summary: a.summary,
      valueUsd: a.valueUsd === null ? null : Number(a.valueUsd),
      txHash: a.txHash,
      at: a.createdAt.toISOString(),
    })),
    transfers: transfers.map((t) => ({
      kind: t.kind,
      status: t.status,
      amountUsd: Number(t.amountUsd),
      failureReason: t.failureReason,
      recoveryAction: t.recoveryAction,
      at: t.createdAt.toISOString(),
    })),
    positions,
    agent: {
      hasWallet: wallet !== null,
      dailyCapUsd: wallet ? Number(wallet.dailyCapUsd) : null,
      mode: agentModeFromEnv(),
      policy: policy
        ? {
            status: policy.status,
            autoTradeEnabled: policy.autoTradeEnabled,
            maxStakePerTradeUsd: policy.maxStakePerTradeUsd,
          }
        : null,
    },
    troubleshoot: {
      pendingTransfers: transfers.filter((t) => t.status === "pending" || t.status === "processing")
        .length,
      failedTransfers: transfers.filter((t) => t.status === "failed").length,
      pendingTrades: activity.filter((a) => a.status === "pending" && a.txHash !== null).length,
      hasAgentWallet: wallet !== null,
      agentMode: agentModeFromEnv(),
      lastFailure: lastFailed?.failureReason ?? null,
    },
  };
}
