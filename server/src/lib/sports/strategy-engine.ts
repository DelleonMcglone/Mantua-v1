/**
 * B9-005 — the execution engine's per-tick orchestration, extracted from the
 * cron route so every path is unit-testable with injected deps.
 *
 * One tick does, per armed strategy:
 *
 *   1. parse the stored config (unparseable → auto-disarm, B9-007);
 *   2. evaluate against market ticks — game-state (freeze/resolution from
 *      the slate) AND price (the pool's own price where one trades,
 *      overlaid by `overlayPoolTicks`; the provider line otherwise);
 *   3. on a trigger, CLAIM the row (armed→triggered, atomic — the
 *      agent-intents `executing` precedent) so two overlapping crons can
 *      never both execute one strategy;
 *   4. execute through the capped agent path (`executeTriggeredClose`:
 *      strategy capUsd clamps the size, the wallet's daily cap gates the
 *      leg, C-015 receipts confirm before `executed` is recorded);
 *   5. settle the claim: executed (poll-finalized) → `executed`; a
 *      retryable hold or failure releases the claim back to `armed`
 *      (failures bounded by MAX_EXECUTE_ATTEMPTS, then auto-disarm);
 *      a non-retryable wait stays `triggered`, recorded for the user.
 *
 * Chain-agnostic (D-112): pool prices come through `chainHomeProbabilityBps`,
 * which is probed per chain in LIVE_ODDS_CHAINS order — nothing here assumes
 * a single chain.
 */

import type { DB } from "../../db/client.ts";
import type { HedgeStrategy } from "../../db/schema/markets.ts";
import { marketIdsFor } from "./resolution.ts";
import { chainHomeProbabilityBps, LIVE_ODDS_CHAINS } from "./live-odds.ts";
import {
  evaluateStrategy,
  strategyConfigSchema,
  type ArmedStrategy,
  type MarketTick,
} from "./strategies.ts";
import {
  auditExecutionHeld,
  claimTriggered,
  engineDisarm,
  engineExecuted,
  engineRelease,
} from "./strategy-store.ts";
import { executeTriggeredClose } from "./strategy-execute.ts";
import type { ProviderSlate } from "./provider.ts";

// ─── Price ticks: the pool's own price ──────────────────────────────────────

/**
 * One pool-price read, with failure distinguished from absence:
 *  - "price": a pool trades — ITS price is the market's opinion;
 *  - "none": no market/pool on any chain — the provider seed stands
 *    (it IS the opening pool price by construction, B1-009);
 *  - "unavailable": a chain read FAILED — the price is dropped so
 *    evaluation holds. Acting on a possibly-stale provider line when the
 *    live price could not be read is the settlement doctrine's cardinal
 *    sin (delay is acceptable; acting on stale data is not).
 */
export type PoolPriceRead =
  | { kind: "price"; bps: number }
  | { kind: "none" }
  | { kind: "unavailable" };

export type PoolPriceReader = (providerEventId: string) => Promise<PoolPriceRead>;

/** Default reader — probes each supported chain in order (D-112). */
export async function readPoolProbability(providerEventId: string): Promise<PoolPriceRead> {
  let sawError = false;
  for (const chainId of LIVE_ODDS_CHAINS) {
    try {
      const p = await chainHomeProbabilityBps(providerEventId, chainId);
      if (p !== null) return { kind: "price", bps: p };
    } catch {
      sawError = true;
    }
  }
  return sawError ? { kind: "unavailable" } : { kind: "none" };
}

/**
 * Overlay live pool prices onto slate-derived ticks, exactly like the
 * board's `withLiveOdds` but for the engine: once a pool trades, its price
 * replaces the provider line (the away market gets the complement). Reads
 * are restricted to events that carry at least one market a strategy
 * references AND that are still live — frozen/resolved markets disarm
 * before any price matters, so their reads would be waste.
 */
export async function overlayPoolTicks(
  ticks: readonly MarketTick[],
  slates: readonly ProviderSlate[],
  relevantMarketIds: ReadonlySet<string>,
  readPool: PoolPriceReader = readPoolProbability,
): Promise<MarketTick[]> {
  const out = ticks.map((t) => ({ ...t }));
  const byId = new Map(out.map((t) => [t.marketId.toLowerCase(), t]));
  for (const slate of slates) {
    if (slate.delayed) continue; // mirrors ticksFromSlates: no stale ticks
    for (const event of slate.events) {
      const [homeId, awayId] = marketIdsFor(event.providerEventId);
      const home = byId.get(homeId.toLowerCase());
      const away = byId.get(awayId.toLowerCase());
      const pair = [home, away].filter((t): t is MarketTick => t !== undefined);
      if (pair.length === 0) continue;
      const live = pair.some((t) => !t.frozen && !t.resolved);
      const relevant = pair.some((t) => relevantMarketIds.has(t.marketId.toLowerCase()));
      if (!live || !relevant) continue;
      const read = await readPool(event.providerEventId);
      if (read.kind === "price") {
        if (home) home.impliedProbBps = read.bps;
        if (away) away.impliedProbBps = 10_000 - read.bps;
      } else if (read.kind === "unavailable") {
        if (home) home.impliedProbBps = null;
        if (away) away.impliedProbBps = null;
      }
      // "none": the provider seed stands — it is the opening price.
    }
  }
  return out;
}

/** Lowercased market ids referenced by the given strategy rows. */
export function referencedMarketIds(rows: readonly HedgeStrategy[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const parsed = strategyConfigSchema.safeParse(row.config);
    if (!parsed.success) continue;
    const config = parsed.data;
    const referenced = config.kind === "take-profit-stop" ? [config.marketId] : config.marketIds;
    for (const id of referenced) ids.add(id.toLowerCase());
  }
  return ids;
}

// ─── Per-strategy processing ────────────────────────────────────────────────

/** Injectable seams for tests — defaults wire the real store + executor. */
export interface EngineDeps {
  disarm?: typeof engineDisarm;
  claim?: typeof claimTriggered;
  markExecuted?: typeof engineExecuted;
  release?: typeof engineRelease;
  auditHeld?: typeof auditExecutionHeld;
  execute?: typeof executeTriggeredClose;
}

/** One strategy's outcome for the tick's response body / logs. */
export interface StrategyTickResult {
  id: string;
  decision: "hold" | "trigger" | "disarm" | "skipped";
  reason?: string;
  execution?: "executed" | "held" | "released" | "disarmed" | "webhook";
}

/**
 * Evaluate and (when triggered) execute ONE armed strategy. Every state
 * transition is a guarded update, so a concurrent tick processing the same
 * row settles to exactly one execution: the claim loser reports `skipped`.
 */
export async function processStrategy(
  db: DB,
  row: HedgeStrategy,
  ticks: readonly MarketTick[],
  nowSeconds: number,
  globallyKilled: boolean,
  deps: EngineDeps = {},
): Promise<StrategyTickResult> {
  const disarm = deps.disarm ?? engineDisarm;
  const claim = deps.claim ?? claimTriggered;
  const markExecuted = deps.markExecuted ?? engineExecuted;
  const release = deps.release ?? engineRelease;
  const auditHeld = deps.auditHeld ?? auditExecutionHeld;
  const execute = deps.execute ?? executeTriggeredClose;

  const parsed = strategyConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    // A stored config this code can no longer parse must not stay armed.
    await disarm(db, row.id, "config-unparseable");
    return { id: row.id, decision: "disarm", reason: "config-unparseable" };
  }

  const strategy: ArmedStrategy = {
    id: row.id,
    config: parsed.data,
    capUsd: Number(row.capUsd),
    expiresAtSeconds: row.expiresAt ? Math.floor(row.expiresAt.getTime() / 1000) : null,
  };
  const decision = evaluateStrategy(strategy, ticks, nowSeconds, globallyKilled);

  if (decision.kind === "hold") {
    return { id: row.id, decision: "hold", reason: decision.reason };
  }
  if (decision.kind === "disarm") {
    await disarm(db, row.id, decision.reason);
    return { id: row.id, decision: "disarm", reason: decision.reason };
  }

  // Trigger: claim BEFORE executing — armed→triggered is one-way per
  // evaluation, and only the claim winner may touch money.
  const claimed = await claim(
    db,
    row.id,
    {
      action: decision.action,
      marketId: decision.marketId,
      ...(decision.deltaUsd !== undefined ? { deltaUsd: decision.deltaUsd } : {}),
    },
    decision.reason,
  );
  if (!claimed) {
    return { id: row.id, decision: "skipped", reason: "claim lost to a concurrent tick" };
  }

  // Never leave the row stuck in `triggered` on an unexpected throw
  // (cap-ledger outage, DB hiccup): release the claim — counted, so a
  // persistent outage disarms at the bound instead of looping forever.
  let exec;
  try {
    exec = await execute(db, claimed, decision);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const released = await release(db, claimed, `${decision.reason} — ${message}`, {
      countAttempt: true,
    });
    return {
      id: row.id,
      decision: "trigger",
      execution: released === "disarmed" ? "disarmed" : "released",
      reason: message,
    };
  }

  if (exec.kind === "executed") {
    if (exec.finalizedBy === "poll") {
      // C-015 — record `executed` only on receipt confirmation; when the
      // webhook finalizer won the race it already closed and audited.
      await markExecuted(
        db,
        row.id,
        {
          action: decision.action,
          marketId: decision.marketId,
          soldRaw: exec.soldRaw,
          usdcOutRaw: exec.usdcOutRaw,
          reason: decision.reason,
        },
        exec.txHash,
      );
      return { id: row.id, decision: "trigger", execution: "executed" };
    }
    return { id: row.id, decision: "trigger", execution: "webhook" };
  }

  if (exec.kind === "held" && !exec.retryable) {
    // Recorded-and-waiting (user-wallet position, no wallet, rebalance):
    // stays `triggered`; the audit row answers "why" on the dashboard.
    await auditHeld(
      db,
      row.id,
      { action: decision.action, marketId: decision.marketId },
      `${decision.reason} — ${exec.reason}`,
    );
    return { id: row.id, decision: "trigger", execution: "held", reason: exec.reason };
  }

  // Retryable hold (daily cap — attempt not counted) or failure (counted,
  // bounded): release the claim so a later tick retries, or auto-disarm at
  // the bound. Never leaves the row stuck.
  const reason = exec.kind === "held" ? exec.reason : exec.error;
  const released = await release(db, claimed, `${decision.reason} — ${reason}`, {
    countAttempt: exec.kind === "failed",
  });
  return {
    id: row.id,
    decision: "trigger",
    execution: released === "disarmed" ? "disarmed" : "released",
    reason,
  };
}
