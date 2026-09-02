import { and, eq, isNull, lt, lte, ne, or } from "drizzle-orm";
import { type Address, formatUnits, parseAbi, parseUnits } from "viem";
import { db } from "../db/client.ts";
import { agentIntents, type AgentIntent } from "../db/schema/agent.ts";
import { users } from "../db/schema/users.ts";
import { logger } from "./logger.ts";
import { logAudit } from "./audit.ts";
import { getAgentWallet, AgentWalletNotFoundError } from "./agent-wallet.ts";
import { quoteAgentSwap, swapFromAgentWallet } from "./agent-swap.ts";
import { getDailyCap, getDailySpend, isSpendingCapEnforced } from "./spending-cap.ts";
import { SafetyError } from "./errors.ts";
import {
  getTradeSignals,
  pegBreached,
  SIGNAL_THRESHOLDS,
  type TradeSignals,
} from "./agent-signals.ts";
import { baseRpcClient } from "./rpc-client.ts";
import { getToken, type TokenSymbol } from "./tokens.ts";
import { tokenAmountUsd } from "./usd-pricing.ts";

/**
 * Resolve path for guard-blocked swaps — the swap tool no longer dead-ends
 * when the safety guard fires. Instead it RESOLVES:
 *
 *  - Peg breach (size-independent): park the whole swap as a standing intent.
 *  - Price-impact breach (size-dependent): binary-search the largest clip
 *    whose quoted impact stays safely under the ceiling, execute that clip
 *    now, and park the remainder as a standing intent.
 *
 * Standing intents are retried by the intent sweep (cron): each run re-checks
 * live signals and fills whatever has become safe — the whole remainder when
 * the verdict clears, or another clip when liquidity has only partially
 * recovered. Intents expire after a TTL so a stale instruction can't fire
 * weeks later; the user can list/cancel them from chat at any time.
 */

/** Execute clips at 90% of the impact ceiling so quote→execution drift can't overshoot it. */
const CLIP_SAFETY_FACTOR = 0.9;
/** Binary-search resolution: amountIn / 2^iterations. */
const CLIP_SEARCH_ITERATIONS = 10;
/** Don't execute clips or keep remainders below this USD value (dust). */
const MIN_CLIP_USD = 1;
/** Per-swap USD ceiling in the sweep — defense-in-depth under the daily spending cap. */
const MAX_INTENT_USD_PER_SWEEP = 100;
/** Standing intents expire after 7 days. */
const INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Retry backoff: base delay doubled per attempt, capped. */
const BACKOFF_BASE_MS = 15 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
/** Claims older than this are from crashed runs (function maxDuration is 300s). */
const CLAIM_STALE_MS = 10 * 60 * 1000;
/** Intents processed per sweep — keeps a run well inside the 300s ceiling
 *  (each fill can take two Circle txs at up to ~60s of polling apiece). */
const MAX_INTENTS_PER_SWEEP = 5;

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

async function balanceOf(symbol: TokenSymbol, owner: Address): Promise<bigint> {
  const t = getToken(symbol);
  if (t.native) return baseRpcClient.getBalance({ address: owner });
  return baseRpcClient.readContract({
    address: t.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
}

/**
 * Largest amountIn (atomic) whose quoted price impact stays under
 * `maxImpactPct`, found by binary search over `impactForAmountRaw`.
 *
 * Returns null when even a ~0.1% probe of the full amount breaches the limit
 * — that's a stale/mispriced pool where impact doesn't shrink with size, so
 * nothing is executable. Non-finite impact readings are treated as unsafe.
 */
export async function findMaxSafeClipRaw(args: {
  amountInRaw: bigint;
  maxImpactPct: number;
  impactForAmountRaw: (raw: bigint) => Promise<number>;
  iterations?: number;
}): Promise<bigint | null> {
  const { amountInRaw, maxImpactPct, impactForAmountRaw } = args;
  const iterations = args.iterations ?? CLIP_SEARCH_ITERATIONS;
  if (amountInRaw <= 0n) return null;

  const safe = async (raw: bigint): Promise<boolean> => {
    if (raw <= 0n) return false;
    const impact = await impactForAmountRaw(raw);
    return Number.isFinite(impact) && impact <= maxImpactPct;
  };

  if (await safe(amountInRaw)) return amountInRaw;

  // Floor probe: if a tiny slice already breaches, the pool spot itself is
  // off (stale pool) and no clip helps.
  const floor = amountInRaw / 1024n > 0n ? amountInRaw / 1024n : 1n;
  if (!(await safe(floor))) return null;

  let lo = floor; // known safe
  let hi = amountInRaw; // known unsafe
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2n;
    if (mid === lo || mid === hi) break;
    if (await safe(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Quote-implied adverse impact (%) for a candidate clip, vs the given spot rate. */
async function impactAtAmount(
  tokenIn: TokenSymbol,
  tokenOut: TokenSymbol,
  amountInRaw: bigint,
  spotRate: number,
): Promise<number> {
  const inDef = getToken(tokenIn);
  const outDef = getToken(tokenOut);
  const amountIn = formatUnits(amountInRaw, inDef.decimals);
  try {
    const q = await quoteAgentSwap({ tokenIn, tokenOut, amountIn });
    const out = Number(formatUnits(BigInt(q.amountOutRaw), outDef.decimals));
    const rate = Number(amountIn) > 0 ? out / Number(amountIn) : NaN;
    return Number.isFinite(rate) && spotRate > 0 ? ((spotRate - rate) / spotRate) * 100 : NaN;
  } catch {
    return NaN; // unquotable size — treated as unsafe by the search
  }
}

export interface ExecutedClip {
  txHash: string;
  explorerUrl: string;
  amountIn: string;
  amountOut: string;
  usdValue: number;
}

export interface IntentSummary {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountRemaining: string;
  status: string;
  reason: string | null;
  lastReason: string | null;
  attempts: number;
  expiresAt: string;
  createdAt: string;
}

export interface ResolveResult {
  /** "clipped" = a partial fill executed now; "parked" = nothing executable yet. */
  action: "clipped" | "parked";
  reasons: string[];
  executed?: ExecutedClip;
  /** Present unless the clip covered all but dust of the request. */
  intent?: IntentSummary;
  note: string;
}

function toSummary(row: AgentIntent): IntentSummary {
  return {
    id: row.id,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    amountIn: row.amountIn,
    amountRemaining: row.amountRemaining,
    status: row.status,
    reason: row.reason,
    lastReason: row.lastReason,
    attempts: row.attempts,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

async function userIdFor(privyUserId: string): Promise<string> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const row = rows.at(0);
  if (!row) throw new Error("User not found for standing intent.");
  return row.id;
}

async function createIntent(args: {
  privyUserId: string;
  walletAddress: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  amountRemaining: string;
  reason: string;
}): Promise<IntentSummary> {
  const userId = await userIdFor(args.privyUserId);
  const inserted = await db
    .insert(agentIntents)
    .values({
      userId,
      walletAddress: args.walletAddress,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountIn: args.amountIn,
      amountRemaining: args.amountRemaining,
      reason: args.reason,
      expiresAt: new Date(Date.now() + INTENT_TTL_MS),
    })
    .returning();
  const row = inserted[0];
  await logAudit({
    walletAddress: args.walletAddress,
    action: "agent_intent",
    outcome: "pending",
    params: {
      event: "created",
      intentId: row.id,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amountRemaining: args.amountRemaining,
      reason: args.reason,
    },
  });
  return toSummary(row);
}

/**
 * Resolve a guard-blocked swap instead of dropping it. Called by the chat
 * swap tool when `getTradeSignals` returns a not-ok verdict (and force is
 * not set). `signals` must be the snapshot that produced the block.
 */
export async function resolveBlockedSwap(args: {
  privyUserId: string;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  amountIn: string;
  signals: TradeSignals;
}): Promise<ResolveResult> {
  const { privyUserId, tokenIn, tokenOut, amountIn, signals } = args;
  const reasons = signals.verdict.reasons;
  const reasonText = reasons.join("; ");

  const wallet = await getAgentWallet(privyUserId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);

  const inDef = getToken(tokenIn);
  const amountRaw = parseUnits(amountIn, inDef.decimals);

  const park = async (remainingRaw: bigint, note: string): Promise<ResolveResult> => {
    const remaining = formatUnits(remainingRaw, inDef.decimals);
    const intent = await createIntent({
      privyUserId,
      walletAddress: wallet.address,
      tokenIn,
      tokenOut,
      amountIn,
      amountRemaining: remaining,
      reason: reasonText,
    });
    return { action: "parked", reasons, intent, note };
  };

  // Peg breaches don't shrink with trade size — park the whole swap.
  if (pegBreached(signals, tokenOut)) {
    return park(
      amountRaw,
      "Held on a peg breach (size-independent). Parked as a standing intent; retried automatically once the peg recovers.",
    );
  }

  const spotRate = signals.trade?.spotRate;
  if (spotRate === undefined || !Number.isFinite(spotRate) || spotRate <= 0) {
    return park(
      amountRaw,
      "Spot pricing unavailable to size a safe clip. Parked whole as a standing intent.",
    );
  }

  // Never clip more than the wallet actually holds.
  const balance = await balanceOf(tokenIn, wallet.address as Address);
  const searchCeiling = amountRaw < balance ? amountRaw : balance;

  const limit = SIGNAL_THRESHOLDS.maxPriceImpactPct * CLIP_SAFETY_FACTOR;
  const clipRaw = await findMaxSafeClipRaw({
    amountInRaw: searchCeiling,
    maxImpactPct: limit,
    impactForAmountRaw: (raw) => impactAtAmount(tokenIn, tokenOut, raw, spotRate),
  });

  if (clipRaw === null || clipRaw <= 0n) {
    return park(
      amountRaw,
      "No executable size — even a minimal clip breaches the impact limit (stale or empty pool). Parked whole as a standing intent.",
    );
  }
  const clipUsd = await tokenAmountUsd(tokenIn, clipRaw);
  if (clipUsd < MIN_CLIP_USD) {
    return park(
      amountRaw,
      "The largest safe clip is below the dust floor. Parked whole as a standing intent.",
    );
  }

  const clipAmount = formatUnits(clipRaw, inDef.decimals);
  const swap = await swapFromAgentWallet({ privyUserId, tokenIn, tokenOut, amountIn: clipAmount });
  const executed: ExecutedClip = {
    txHash: swap.txHash,
    explorerUrl: swap.explorerUrl,
    amountIn: clipAmount,
    amountOut: formatUnits(BigInt(swap.amountOutRaw), getToken(tokenOut).decimals),
    usdValue: swap.usdValue,
  };

  const remainderRaw = amountRaw - clipRaw;
  const remainderUsd = remainderRaw > 0n ? await tokenAmountUsd(tokenIn, remainderRaw) : 0;
  if (remainderRaw <= 0n || remainderUsd < MIN_CLIP_USD) {
    return {
      action: "clipped",
      reasons,
      executed,
      note: "Executed the largest safe clip; the remainder was dust, so nothing was parked.",
    };
  }

  const result = await park(
    remainderRaw,
    "Executed the largest clip under the impact limit now; the remainder is parked as a standing intent and retried automatically as liquidity recovers.",
  );
  return { ...result, action: "clipped", executed };
}

/** The user's standing intents, newest first (all statuses, capped). */
export async function listIntents(privyUserId: string): Promise<IntentSummary[]> {
  const userId = await userIdFor(privyUserId);
  const rows = await db
    .select()
    .from(agentIntents)
    .where(eq(agentIntents.userId, userId))
    .orderBy(agentIntents.createdAt)
    .limit(50);
  return rows.reverse().map(toSummary);
}

/** Cancel one of the user's pending intents. */
export async function cancelIntent(privyUserId: string, intentId: string): Promise<IntentSummary> {
  const userId = await userIdFor(privyUserId);
  const updated = await db
    .update(agentIntents)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(agentIntents.id, intentId),
        eq(agentIntents.userId, userId),
        eq(agentIntents.status, "pending"),
      ),
    )
    .returning();
  const row = updated.at(0);
  if (!row) throw new Error("No pending intent with that id.");
  await logAudit({
    walletAddress: row.walletAddress,
    action: "agent_intent",
    outcome: "success",
    params: { event: "cancelled", intentId: row.id },
  });
  return toSummary(row);
}

export interface IntentSweepAction {
  intentId: string;
  pair: string;
  outcome: "filled" | "partial" | "skipped" | "expired" | "error";
  reason: string;
  txHash?: string;
}

export interface IntentSweepSummary {
  checked: number;
  filled: number;
  partial: number;
  skipped: number;
  expired: number;
  errors: number;
  actions: IntentSweepAction[];
}

/**
 * Retry backoff: skipped intents wait min(15min × 2^attempts, 6h) before the
 * sweep reconsiders them. Cleared on any fill (the strongest "conditions
 * improved" signal) and ignored by opportunistic pair triggers.
 */
export function computeBackoffMs(attempts: number): number {
  const exp = Math.min(Math.max(attempts, 0), 30); // clamp: 2^30 already > 6h in ms
  return Math.min(BACKOFF_BASE_MS * 2 ** exp, BACKOFF_MAX_MS);
}

/** The daily-cap reset boundary (00:00 UTC) after `from`. */
export function nextUtcMidnight(from: Date): Date {
  const d = new Date(from);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

/**
 * Claim an intent for execution: pending → executing, atomically. Returns the
 * claimed row, or null when another run already claimed/settled it. Every
 * subsequent write in the processing path is guarded `AND status='executing'`
 * so a stale process's late write can't stomp a reclaimed-and-refilled row.
 */
async function claimIntent(intentId: string): Promise<AgentIntent | null> {
  const rows = await db
    .update(agentIntents)
    .set({ status: "executing", updatedAt: new Date() })
    .where(and(eq(agentIntents.id, intentId), eq(agentIntents.status, "pending")))
    .returning();
  return rows.at(0) ?? null;
}

/** Release a claimed intent back to pending as a skip: attempt counted (unless
 *  countAttempt=false, e.g. cap-exhausted), lastReason set, backoff applied. */
async function releaseSkipped(
  claimed: AgentIntent,
  reason: string,
  opts: { nextCheckAt: Date; countAttempt: boolean },
): Promise<void> {
  const now = new Date();
  await db
    .update(agentIntents)
    .set({
      status: "pending",
      attempts: opts.countAttempt ? claimed.attempts + 1 : claimed.attempts,
      lastCheckedAt: now,
      lastReason: reason,
      nextCheckAt: opts.nextCheckAt,
      updatedAt: now,
    })
    .where(and(eq(agentIntents.id, claimed.id), eq(agentIntents.status, "executing")));
}

/**
 * Process one CLAIMED intent against live signals: fill the whole remainder
 * when the verdict clears, another safe clip when liquidity only partially
 * recovered, or release with backoff. Shared by the cron sweep and the
 * opportunistic pair triggers. Never leaves the row in `executing` on a
 * normal path; the caller's catch releases it on unexpected errors.
 */
async function processClaimedIntent(
  claimed: AgentIntent,
  privyUserId: string,
  triggerSource: string,
): Promise<IntentSweepAction> {
  const pair = `${claimed.tokenIn}->${claimed.tokenOut}`;
  const tokenIn = claimed.tokenIn as TokenSymbol;
  const tokenOut = claimed.tokenOut as TokenSymbol;
  const inDef = getToken(tokenIn);
  let remainingRaw = parseUnits(claimed.amountRemaining, inDef.decimals);
  const backoffAt = (): Date => new Date(Date.now() + computeBackoffMs(claimed.attempts));

  // Clamp the attempt to balance and the per-sweep USD ceiling.
  const balance = await balanceOf(tokenIn, claimed.walletAddress as Address);
  let targetRaw = remainingRaw < balance ? remainingRaw : balance;
  if (targetRaw > 0n) {
    const targetUsd = await tokenAmountUsd(tokenIn, targetRaw);
    if (targetUsd > MAX_INTENT_USD_PER_SWEEP) {
      const fracPpm = BigInt(Math.floor((MAX_INTENT_USD_PER_SWEEP / targetUsd) * 1_000_000));
      targetRaw = (targetRaw * fracPpm) / 1_000_000n;
    }
  }
  if (targetRaw <= 0n) {
    const reason = "insufficient agent balance";
    await releaseSkipped(claimed, reason, { nextCheckAt: backoffAt(), countAttempt: true });
    return { intentId: claimed.id, pair, outcome: "skipped", reason };
  }

  // Spending-cap preflight: clamp to today's remaining headroom; when the
  // wallet is capped out, shelve until the UTC-midnight reset WITHOUT
  // counting an attempt (nothing about the trade itself was wrong).
  if (isSpendingCapEnforced()) {
    const [cap, spent] = await Promise.all([
      getDailyCap(claimed.walletAddress),
      getDailySpend(claimed.walletAddress),
    ]);
    const headroomUsd = cap - spent;
    if (headroomUsd < MIN_CLIP_USD) {
      const reason = `daily spending cap reached ($${spent.toFixed(2)}/$${String(cap)})`;
      await releaseSkipped(claimed, reason, {
        nextCheckAt: nextUtcMidnight(new Date()),
        countAttempt: false,
      });
      return { intentId: claimed.id, pair, outcome: "skipped", reason };
    }
    const targetUsd = await tokenAmountUsd(tokenIn, targetRaw);
    if (targetUsd > headroomUsd) {
      const fracPpm = BigInt(Math.floor((headroomUsd / targetUsd) * 1_000_000));
      targetRaw = (targetRaw * fracPpm) / 1_000_000n;
    }
    if (targetRaw <= 0n) {
      const reason = "daily spending cap headroom below dust";
      await releaseSkipped(claimed, reason, {
        nextCheckAt: nextUtcMidnight(new Date()),
        countAttempt: false,
      });
      return { intentId: claimed.id, pair, outcome: "skipped", reason };
    }
  }

  const targetAmount = formatUnits(targetRaw, inDef.decimals);
  const signals = await getTradeSignals({ tokenIn, tokenOut, amountIn: targetAmount });

  let execRaw: bigint | null = null;
  if (signals.verdict.ok) {
    execRaw = targetRaw;
  } else if (!pegBreached(signals, tokenOut)) {
    const spotRate = signals.trade?.spotRate;
    if (spotRate !== undefined && Number.isFinite(spotRate) && spotRate > 0) {
      const limit = SIGNAL_THRESHOLDS.maxPriceImpactPct * CLIP_SAFETY_FACTOR;
      execRaw = await findMaxSafeClipRaw({
        amountInRaw: targetRaw,
        maxImpactPct: limit,
        impactForAmountRaw: (raw) => impactAtAmount(tokenIn, tokenOut, raw, spotRate),
      });
    }
  }
  if (execRaw !== null && execRaw > 0n) {
    const execUsd = await tokenAmountUsd(tokenIn, execRaw);
    if (execUsd < MIN_CLIP_USD) execRaw = null;
  }

  if (execRaw === null || execRaw <= 0n) {
    const reason = signals.verdict.reasons.join("; ") || "no executable size";
    await releaseSkipped(claimed, reason, { nextCheckAt: backoffAt(), countAttempt: true });
    return { intentId: claimed.id, pair, outcome: "skipped", reason };
  }

  // Stamp the row before broadcasting so a crash between the on-chain swap
  // and the DB update below is auditable when the stale claim is reclaimed.
  const execAmount = formatUnits(execRaw, inDef.decimals);
  await db
    .update(agentIntents)
    .set({ lastReason: `executing swap of ${execAmount} ${tokenIn}`, updatedAt: new Date() })
    .where(and(eq(agentIntents.id, claimed.id), eq(agentIntents.status, "executing")));

  const swap = await swapFromAgentWallet({ privyUserId, tokenIn, tokenOut, amountIn: execAmount });

  remainingRaw -= execRaw;
  const remainingUsd = remainingRaw > 0n ? await tokenAmountUsd(tokenIn, remainingRaw) : 0;
  const done = remainingRaw <= 0n || remainingUsd < MIN_CLIP_USD;
  const now = new Date();
  await db
    .update(agentIntents)
    .set({
      amountRemaining: formatUnits(remainingRaw > 0n ? remainingRaw : 0n, inDef.decimals),
      status: done ? "filled" : "pending",
      attempts: claimed.attempts + 1,
      lastCheckedAt: now,
      lastReason: null,
      // A fill is the strongest "conditions improved" signal — retry the
      // remainder immediately rather than serving out an old backoff.
      nextCheckAt: null,
      updatedAt: now,
    })
    .where(and(eq(agentIntents.id, claimed.id), eq(agentIntents.status, "executing")));

  await logAudit({
    walletAddress: claimed.walletAddress,
    action: "agent_swap",
    outcome: "success",
    txHash: swap.txHash,
    params: {
      triggerSource,
      intentId: claimed.id,
      tokenIn,
      tokenOut,
      amountIn: execAmount,
      usdValue: swap.usdValue,
      intentStatus: done ? "filled" : "pending",
    },
  });
  return {
    intentId: claimed.id,
    pair,
    outcome: done ? "filled" : "partial",
    reason: `executed ${execAmount} ${tokenIn}`,
    txHash: swap.txHash,
  };
}

/** Claim + process + error-release for one intent id. Never throws. */
async function runOneIntent(
  intentId: string,
  privyUserId: string,
  triggerSource: string,
): Promise<IntentSweepAction | null> {
  const claimed = await claimIntent(intentId);
  if (!claimed) return null; // raced by another run — fine
  try {
    return await processClaimedIntent(claimed, privyUserId, triggerSource);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ err, intentId }, "intent processing failed");
    const capExhausted = err instanceof SafetyError && err.code === "spending_cap_exceeded";
    await releaseSkipped(claimed, reason, {
      nextCheckAt: capExhausted
        ? nextUtcMidnight(new Date())
        : new Date(Date.now() + computeBackoffMs(claimed.attempts)),
      countAttempt: !capExhausted,
    }).catch(() => {});
    await logAudit({
      walletAddress: claimed.walletAddress,
      action: "agent_swap",
      outcome: "failure",
      params: { triggerSource, intentId, error: reason },
    });
    return {
      intentId,
      pair: `${claimed.tokenIn}->${claimed.tokenOut}`,
      outcome: capExhausted ? "skipped" : "error",
      reason,
    };
  }
}

/**
 * Retry pending standing intents against live signals. Runs frequently (every
 * 15 min via cron), so it is concurrency-safe (claim-based execution),
 * backoff-aware, and bounded: at most MAX_INTENTS_PER_SWEEP intents per run so
 * a sweep fits comfortably inside the function's 300s ceiling. One intent's
 * failure never aborts the sweep.
 */
export async function runIntentSweep(): Promise<IntentSweepSummary> {
  const summary: IntentSweepSummary = {
    checked: 0,
    filled: 0,
    partial: 0,
    skipped: 0,
    expired: 0,
    errors: 0,
    actions: [],
  };
  const now = new Date();

  // Reclaim stale claims from crashed runs. 10 min > the 300s function
  // maxDuration, so a claim older than that cannot still be alive.
  const reclaimed = await db
    .update(agentIntents)
    .set({ status: "pending", updatedAt: now })
    .where(
      and(
        eq(agentIntents.status, "executing"),
        lt(agentIntents.updatedAt, new Date(now.getTime() - CLAIM_STALE_MS)),
      ),
    )
    .returning({ id: agentIntents.id, lastReason: agentIntents.lastReason });
  for (const row of reclaimed) {
    logger.warn({ intentId: row.id, lastReason: row.lastReason }, "reclaimed stale intent claim");
  }

  // Expire before selecting so stale instructions can't fire.
  const expired = await db
    .update(agentIntents)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(agentIntents.status, "pending"), lt(agentIntents.expiresAt, now)))
    .returning();
  for (const row of expired) {
    summary.expired++;
    summary.actions.push({
      intentId: row.id,
      pair: `${row.tokenIn}->${row.tokenOut}`,
      outcome: "expired",
      reason: "intent TTL elapsed",
    });
    await logAudit({
      walletAddress: row.walletAddress,
      action: "agent_intent",
      outcome: "rejected_other",
      params: { event: "expired", intentId: row.id, amountRemaining: row.amountRemaining },
    });
  }

  const eligible = await db
    .select({ intentId: agentIntents.id, privyUserId: users.privyUserId })
    .from(agentIntents)
    .innerJoin(users, eq(agentIntents.userId, users.id))
    .where(
      and(
        eq(agentIntents.status, "pending"),
        or(isNull(agentIntents.nextCheckAt), lte(agentIntents.nextCheckAt, now)),
      ),
    )
    .orderBy(agentIntents.createdAt)
    .limit(MAX_INTENTS_PER_SWEEP);

  for (const { intentId, privyUserId } of eligible) {
    summary.checked++;
    const action = await runOneIntent(intentId, privyUserId, "intent_sweep");
    if (!action) continue;
    summary.actions.push(action);
    if (action.outcome === "filled") summary.filled++;
    else if (action.outcome === "partial") summary.partial++;
    else if (action.outcome === "skipped") summary.skipped++;
    else if (action.outcome === "error") summary.errors++;
  }

  return summary;
}

/**
 * Opportunistic retry after an action that changed a pool's state (a swap or
 * liquidity change in chat): immediately re-try pending intents on the SAME
 * unordered pair — a swap moves price in favor of the OPPOSITE direction and
 * liquidity changes affect both, so direction is deliberately not matched.
 * Ignores backoff (conditions just changed). Bounded and never throws; the
 * cron sweep is the backstop if this is cut short.
 */
export async function retryIntentsForPair(
  tokenA: TokenSymbol,
  tokenB: TokenSymbol,
  opts: { excludeIntentId?: string | undefined; max?: number } = {},
): Promise<IntentSweepAction[]> {
  const max = opts.max ?? 2;
  const actions: IntentSweepAction[] = [];
  try {
    const pairMatch = or(
      and(eq(agentIntents.tokenIn, tokenA), eq(agentIntents.tokenOut, tokenB)),
      and(eq(agentIntents.tokenIn, tokenB), eq(agentIntents.tokenOut, tokenA)),
    );
    const rows = await db
      .select({ intentId: agentIntents.id, privyUserId: users.privyUserId })
      .from(agentIntents)
      .innerJoin(users, eq(agentIntents.userId, users.id))
      .where(
        opts.excludeIntentId
          ? and(
              eq(agentIntents.status, "pending"),
              pairMatch,
              ne(agentIntents.id, opts.excludeIntentId),
            )
          : and(eq(agentIntents.status, "pending"), pairMatch),
      )
      .orderBy(agentIntents.createdAt)
      .limit(max);
    for (const { intentId, privyUserId } of rows) {
      const action = await runOneIntent(intentId, privyUserId, "pair_trigger");
      if (action) actions.push(action);
    }
    if (actions.length > 0) {
      logger.info({ tokenA, tokenB, actions }, "opportunistic intent retry ran");
    }
  } catch (err) {
    logger.warn({ err, tokenA, tokenB }, "opportunistic intent retry failed");
  }
  return actions;
}
