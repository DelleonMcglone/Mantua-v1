import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getTableColumns } from "drizzle-orm";

/**
 * B10-006 — Hedging E2E: arm strategy → trigger fires → executes under cap →
 * disarms on freeze.
 *
 * One continuous journey composing the SHIPPED modules, each stage's output
 * feeding the next as its genuine input:
 *
 *   1. ARM — natural language → `parseStrategyDraft` → `previewLines` →
 *      the user-confirmed structured config → `armStrategy` (real store code
 *      writing the strategy row + `strategy_arm` audit row).
 *   2. TRIGGER — the real evaluation pipeline: `ticksFromSlates` (game-state
 *      ticks) + `overlayPoolTicks` (the pool's own price) feed
 *      `processStrategy`, which holds inside thresholds and fires when the
 *      pool price crosses take-profit.
 *   3. CLAIM-ONCE — two overlapping engine sweeps race on the same row; the
 *      real `claimTriggered` guarded update lets exactly one win. The loser
 *      reports `skipped` and never touches money.
 *   4. EXECUTE UNDER CAP — the real `executeTriggeredClose`: agent balance
 *      clamped by the strategy's capUsd, the wallet's daily cap checked
 *      BEFORE the trade, and the Circle leg resolved by the REAL
 *      `pollReceipt` state machine (receipt-confirmed, C-015). `executed` +
 *      its audit row (with the tx hash) are written by the real
 *      `engineExecuted` only after the confirmed receipt.
 *   5. FAILURE HONESTY — a Circle execution stuck at SENT never counts as
 *      success: the poll times out, the attempt is counted, and after
 *      MAX_EXECUTE_ATTEMPTS (3) the strategy auto-disarms (`execute-failed`).
 *   6. IN-PLAY + DISARM ON FREEZE (D-103) — the freeze signal the engine
 *      really consults (`ticksFromSlates`: event FINAL/void, or past the
 *      `startsAt + MAX_EVENT_DURATION_SECONDS` backstop — the same
 *      state-driven clock the contract freeze moved to) keeps the strategy
 *      ARMED and executing during a live game, and disarms it BEFORE
 *      trigger evaluation once the game goes final; a price past
 *      take-profit arriving with the freeze produces zero executions and
 *      zero spend. (B10-006's "disarms on freeze" survives — the freeze
 *      moved from kickoff to final.)
 *
 * What is real vs stubbed: strategies.ts, strategy-engine.ts,
 * strategy-store.ts (arm/claim/release/executed/disarm + audit rows),
 * strategy-execute.ts, strategy-parse.ts, and circle/execute.ts's
 * `pollReceipt` all run for real. Stubs sit only at the external seams the
 * shipped code exposes for tests: an in-memory drizzle-shaped DB (evaluating
 * the store's own guarded `where` conditions against shared rows, so the
 * claim atomicity proven is the real guarded-update semantics), a
 * `TransactionFetcher` script driving `pollReceipt` (the DI seam in
 * circle/execute.ts), the `ExecuteCloseDeps` seams (balance read, daily-cap
 * ledger fake per the SpendGuardIo convention, and the trade leg — which
 * itself resolves through the real `pollReceipt`).
 */

import type { DB } from "../../db/client.ts";
import type { HedgeStrategy } from "../../db/schema/markets.ts";
import { hedgeStrategies } from "../../db/schema/markets.ts";
import { mantuaAuditLog } from "../../db/schema/safety.ts";
import { agentWallets, markets } from "../../db/schema/index.ts";
import { SafetyError } from "../errors.ts";
import { pollReceipt, type TransactionFetcher, type TransactionState } from "../circle/execute.ts";
import { parseStrategyDraft, previewLines } from "./strategy-parse.ts";
import {
  MAX_EVENT_DURATION_SECONDS,
  strategyConfigSchema,
  ticksFromSlates,
  type StrategyConfig,
} from "./strategies.ts";
import {
  overlayPoolTicks,
  processStrategy,
  referencedMarketIds,
  type EngineDeps,
} from "./strategy-engine.ts";
import { armStrategy, listArmed, MAX_EXECUTE_ATTEMPTS } from "./strategy-store.ts";
import { executeTriggeredClose, type ExecuteCloseDeps } from "./strategy-execute.ts";
import { marketIdsFor } from "./resolution.ts";
import type { ProviderEvent, ProviderSlate, ProviderTeam } from "./provider.ts";

const NOW = 1_800_000_000;
const USER_ID = "00000000-0000-0000-0000-0000000000a1";
const AGENT_WALLET = {
  circleWalletId: "cw_1",
  address: "0xabc0000000000000000000000000000000000001",
};
const TX_CONFIRMED = `0x${"a".repeat(64)}`;
const TX_BROADCAST_ONLY = `0x${"b".repeat(64)}`;

// ─── In-memory drizzle-shaped DB ────────────────────────────────────────────
//
// The strategy store runs REAL guarded updates (`update … set … where
// eq(id) and eq(status) … returning`). This fake evaluates those exact
// conditions against shared in-memory rows, so armed→triggered claim
// atomicity is the store's own semantics, not a scripted answer. It supports
// only the fragments strategy-store/strategy-execute actually emit
// (conjunctions of `=` / `<>` and the `coalesce(col, now())` timestamp set).

const columnKeys = new WeakMap<object, string>();
for (const table of [hedgeStrategies, mantuaAuditLog, markets, agentWallets]) {
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    columnKeys.set(col as object, key);
  }
}

interface Comparison {
  key: string;
  op: "=" | "<>";
  value: unknown;
}

function chunkText(chunk: unknown): string | null {
  if (chunk && typeof chunk === "object" && "value" in chunk) {
    const v = chunk.value;
    if (Array.isArray(v)) return v.join("");
  }
  return null;
}

function collectComparisons(node: unknown, out: Comparison[]): void {
  const chunks = (node as { queryChunks?: unknown[] } | null | undefined)?.queryChunks;
  if (!chunks) return;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const key = chunk && typeof chunk === "object" ? columnKeys.get(chunk) : undefined;
    if (key !== undefined) {
      const op = chunkText(chunks[i + 1])?.trim();
      const param = chunks[i + 2];
      if ((op === "=" || op === "<>") && param && typeof param === "object" && "value" in param) {
        out.push({ key, op, value: param.value });
      }
    } else {
      collectComparisons(chunk, out);
    }
  }
}

function rowMatches(row: Record<string, unknown>, cond: unknown): boolean {
  const cmps: Comparison[] = [];
  collectComparisons(cond, cmps);
  return (
    cmps.length > 0 &&
    cmps.every((c) => (c.op === "=" ? row[c.key] === c.value : row[c.key] !== c.value))
  );
}

/** Apply an update's set clause; `sql\`coalesce(col, now())\`` keeps the first value. */
function applySet(row: Record<string, unknown>, set: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(set)) {
    if (v && typeof v === "object" && "queryChunks" in v) {
      row[k] = row[k] ?? new Date();
    } else {
      row[k] = v;
    }
  }
}

interface AuditRow {
  action: string;
  outcome: string;
  params: Record<string, unknown>;
  reason?: string;
  txHash?: string;
}

const strategyRows: Record<string, unknown>[] = [];
const auditRows: AuditRow[] = [];
/** Joined markets×events view served to strategy-execute's market lookup. */
const joinedMarkets: Record<string, unknown>[] = [];
let idCounter = 0;

function thenable<T>(
  rows: T[],
): Promise<T[]> & { limit: () => Promise<T[]>; returning: () => Promise<T[]> } {
  const p = Promise.resolve(rows);
  return Object.assign(p, { limit: () => p, returning: () => p });
}

const db = {
  insert: (table: unknown) => ({
    values: (row: Record<string, unknown>) => {
      if (table === hedgeStrategies) {
        idCounter += 1;
        const full: Record<string, unknown> = {
          id: `00000000-0000-0000-0000-0000000000${String(idCounter).padStart(2, "0")}`,
          marketId: null,
          status: "armed",
          expiresAt: null,
          triggeredAt: null,
          executedAt: null,
          disarmedReason: null,
          executeAttempts: 0,
          armedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...row,
        };
        strategyRows.push(full);
        return thenable([{ ...full }]);
      }
      auditRows.push(row as unknown as AuditRow);
      return thenable([{ ...row }]);
    },
  }),
  update: (_table: unknown) => ({
    set: (vals: Record<string, unknown>) => ({
      // The mutation applies synchronously inside `.where()` — one guarded
      // check-and-set per matching row, the in-memory analogue of the SQL
      // row-level atomicity the store relies on.
      where: (cond: unknown) => {
        const matched = strategyRows.filter((r) => rowMatches(r, cond));
        for (const r of matched) applySet(r, vals);
        return thenable(matched.map((r) => ({ ...r })));
      },
    }),
  }),
  select: (_cols?: unknown) => ({
    from: (table: unknown) => {
      if (table === hedgeStrategies) {
        return {
          where: (cond: unknown) =>
            thenable(strategyRows.filter((r) => rowMatches(r, cond)).map((r) => ({ ...r }))),
        };
      }
      if (table === agentWallets) {
        return { where: () => thenable([{ ...AGENT_WALLET }]) };
      }
      // strategy-execute's markets ⋈ events read.
      return {
        innerJoin: () => ({
          where: (cond: unknown) =>
            thenable(joinedMarkets.filter((r) => rowMatches(r, cond)).map((r) => ({ ...r }))),
        }),
      };
    },
  }),
} as unknown as DB;

function strategyRow(id: string): HedgeStrategy {
  const row = strategyRows.find((r) => r["id"] === id);
  assert.ok(row, `strategy row ${id} missing`);
  return row as unknown as HedgeStrategy;
}

function auditFor(strategyId: string): AuditRow[] {
  return auditRows.filter((r) => r.params["strategyId"] === strategyId);
}

// ─── Slate / tick fixtures (the engine's real inputs) ───────────────────────

function team(key: string): ProviderTeam {
  return { providerId: key, key: `nfl:${key}`, name: key, abbreviation: key };
}

function event(overrides: Partial<ProviderEvent> & { providerEventId: string }): ProviderEvent {
  return {
    league: "nfl",
    startsAt: NOW + 3600,
    status: "scheduled",
    home: team("HOME"),
    away: team("AWAY"),
    homeWinProbabilityBps: 6000,
    ...overrides,
  };
}

function slateOf(events: ProviderEvent[]): ProviderSlate {
  return { provider: "espn", league: "nfl", events, delayed: false, fetchedAt: NOW };
}

// ─── External-seam fakes ────────────────────────────────────────────────────

/** Daily-cap ledger fake (SpendGuardIo convention): check enforces against
 *  what has been recorded — nothing here scripts an answer per call. */
function makeDailyLedger(capUsd: number): {
  checks: { wallet: string; usd: number }[];
  check: (address: string, usd: number) => Promise<void>;
} {
  const checks: { wallet: string; usd: number }[] = [];
  const spent = 0; // strategy closes are sells — they check headroom, never record spend
  return {
    checks,
    check: (address, usd) => {
      checks.push({ wallet: address, usd });
      if (spent + usd > capUsd) {
        return Promise.reject(
          new SafetyError("spending_cap_exceeded", "daily spending cap reached", {
            cap: capUsd,
            spent,
            usdAmount: usd,
          }),
        );
      }
      return Promise.resolve();
    },
  };
}

/** Scripted Circle transaction states, consumed by the REAL pollReceipt. */
function scriptedCircle(states: { state: TransactionState; txHash?: string }[]): {
  fetcher: TransactionFetcher["getTransaction"];
  polls: () => number;
} {
  let polls = 0;
  const fetcher: TransactionFetcher["getTransaction"] = () => {
    const s = states[Math.min(polls, states.length - 1)];
    polls += 1;
    return Promise.resolve({ data: { transaction: { ...s } } });
  };
  return { fetcher, polls: () => polls };
}

interface TradeCall {
  amountRaw: bigint;
  direction: string;
  outcomeIndex: number;
  providerEventId: string;
}

/**
 * ExecuteCloseDeps whose trade leg resolves through the REAL `pollReceipt`
 * state machine: a script stuck at SENT throws the receipt-timeout (never
 * success); only a CONFIRMED/COMPLETE terminal state yields a tx hash.
 */
function makeExecDeps(opts: {
  balance: bigint;
  ledger: ReturnType<typeof makeDailyLedger>;
  circleStates: { state: TransactionState; txHash?: string }[];
  pollTimeoutMs: number;
  order?: string[];
}): { deps: ExecuteCloseDeps; tradeCalls: TradeCall[] } {
  const tradeCalls: TradeCall[] = [];
  const deps: ExecuteCloseDeps = {
    balanceOf: () => Promise.resolve(opts.balance),
    // Task 057 — the user's hedge policy: the defaults, with a budget and
    // per-leg ceiling above every amount this journey moves.
    hedgeContext: () =>
      Promise.resolve({
        view: {
          status: "active" as const,
          autoTradeEnabled: false,
          maxStakePerTradeUsd: 25,
          riskLevel: "conservative" as const,
          allowedLeagues: [],
          hedge: {
            maxSizeUsd: 10_000,
            maxExposureUsd: 10_000,
            minConfidenceBps: 0,
            cooldownMinutes: 0,
            dailyBudgetUsd: 10_000,
            allowedMarketTypes: [],
          },
          updatedAt: null,
          persisted: false,
        },
        lastHedgeAtMs: null,
        spentTodayUsd: 0,
      }),
    checkSpendingCap: (address, usd) => {
      opts.order?.push(`cap-check:${String(usd)}`);
      return opts.ledger.check(address, usd);
    },
    agentMarketTrade: async (args) => {
      opts.order?.push("trade");
      tradeCalls.push({
        amountRaw: args.amountRaw,
        direction: args.direction,
        outcomeIndex: args.outcomeIndex,
        providerEventId: args.providerEventId,
      });
      const { fetcher } = scriptedCircle(opts.circleStates);
      const receipt = await pollReceipt(`ctx_${String(tradeCalls.length)}`, fetcher, {
        intervalMs: 1,
        timeoutMs: opts.pollTimeoutMs,
      });
      return {
        txHash: receipt.txHash,
        circleTxId: receipt.id,
        finalizedBy: "poll",
        marketId: marketIdsFor(args.providerEventId)[args.outcomeIndex],
        quote: {
          amountIn: args.amountRaw.toString(),
          amountOut: (args.amountRaw - args.amountRaw / 100n).toString(),
          effectivePriceBps: null,
        },
      };
    },
  };
  return { deps, tradeCalls };
}

function engineDeps(execDeps: ExecuteCloseDeps): EngineDeps {
  return {
    execute: (dbArg, rowArg, decision) => executeTriggeredClose(dbArg, rowArg, decision, execDeps),
  };
}

/** One engine sweep, exactly as cron-strategies composes it. */
async function sweep(
  slates: ProviderSlate[],
  readPool: (
    providerEventId: string,
  ) => Promise<{ kind: "price"; bps: number } | { kind: "none" } | { kind: "unavailable" }>,
  deps: EngineDeps,
  onlyStrategyId?: string,
): Promise<Awaited<ReturnType<typeof processStrategy>>[]> {
  const armed = (await listArmed(db)).filter((r) => !onlyStrategyId || r.id === onlyStrategyId);
  const ticks = await overlayPoolTicks(
    ticksFromSlates(slates, NOW),
    slates,
    referencedMarketIds(armed),
    readPool,
  );
  const results = [];
  for (const row of armed) results.push(await processStrategy(db, row, ticks, NOW, false, deps));
  return results;
}

// ─── The journey ────────────────────────────────────────────────────────────

describe("B10-006 hedging E2E — arm → trigger → claim-once → execute under cap", () => {
  const EVT_A = "401e2ea";
  const [MARKET_A] = marketIdsFor(EVT_A);
  const slatesA = [slateOf([event({ providerEventId: EVT_A })])];

  it("runs the whole journey over one strategy: NL arm, hold, price-move trigger, single claim, cap-clamped receipt-confirmed close, audit trail", async () => {
    // Stage 1 — natural language → draft → preview. Nothing arms yet.
    const draft = parseStrategyDraft("take profit at 80% on the chiefs market, cap $100");
    assert.ok(draft, "the shipped parser must produce a draft from the NL");
    assert.equal(draft.kind, "take-profit-stop");
    assert.equal(draft.takeProfitBps, 8000);
    assert.equal(draft.capUsd, 100);
    assert.equal(draft.teamQuery, "chiefs");
    const preview = previewLines(draft);
    assert.ok(preview.some((l) => l.includes("Spend cap: $100 USDC")));
    assert.ok(
      preview.some((l) => l.includes("Nothing arms until you confirm")),
      "the preview itself promises confirm-gating",
    );
    assert.equal(strategyRows.length, 0, "parse + preview must arm NOTHING");

    // Stage 1b — the user confirms the STRUCTURED config (the route's
    // armSchema contract: numbers, not prose), resolved to a real market id.
    const config: StrategyConfig = strategyConfigSchema.parse({
      kind: "take-profit-stop",
      marketId: MARKET_A,
      side: "yes",
      takeProfitBps: draft.takeProfitBps,
    });
    const armed = await armStrategy(db, USER_ID, config, draft.capUsd ?? 0, null);
    assert.equal(armed.status, "armed");
    assert.equal(armed.capUsd, "100.00");
    assert.deepEqual(
      auditFor(armed.id).map((r) => `${r.action}/${r.outcome}`),
      ["strategy_arm/armed"],
    );

    // The market + wallet rows the execute leg will select.
    joinedMarkets.push({
      marketId: MARKET_A,
      yesToken: "0xyes00000000000000000000000000000000000a",
      outcomeIndex: 0,
      providerEventId: EVT_A,
    });

    const ledger = makeDailyLedger(150);
    const order: string[] = [];
    const { deps: execDeps, tradeCalls } = makeExecDeps({
      balance: 250_000_000n, // 250 YES — more than the $100 strategy cap allows
      ledger,
      circleStates: [
        { state: "QUEUED" },
        { state: "SENT", txHash: TX_CONFIRMED }, // a hash exists at SENT — not success yet
        { state: "CONFIRMED", txHash: TX_CONFIRMED },
      ],
      pollTimeoutMs: 2_000,
      order,
    });
    const deps = engineDeps(execDeps);

    // Stage 2a — inside thresholds (no pool trading yet → provider seed
    // 6000bps < 8000bps take-profit): the engine HOLDS, no claim, no money.
    const holdResults = await sweep(
      slatesA,
      () => Promise.resolve({ kind: "none" }),
      deps,
      armed.id,
    );
    assert.equal(holdResults.length, 1);
    assert.equal(holdResults[0].decision, "hold");
    assert.equal(strategyRow(armed.id).status, "armed");
    assert.equal(tradeCalls.length, 0);
    assert.equal(ledger.checks.length, 0, "a hold must never reach the cap ledger");

    // Stage 2b + 3 — the pool's own price crosses take-profit (8500bps ≥
    // 8000bps) and TWO overlapping sweeps race on the same armed row.
    const readPrice = (): Promise<{ kind: "price"; bps: number }> =>
      Promise.resolve({ kind: "price" as const, bps: 8500 });
    const [raceA, raceB] = await Promise.all([
      sweep(slatesA, readPrice, deps, armed.id),
      sweep(slatesA, readPrice, deps, armed.id),
    ]);
    const outcomes = [...raceA, ...raceB];
    const executed = outcomes.filter((r) => r.execution === "executed");
    const skipped = outcomes.filter((r) => r.decision === "skipped");
    assert.equal(executed.length, 1, "exactly one sweep may win the claim and execute");
    assert.equal(skipped.length, 1, "the claim loser must report skipped and touch no money");
    assert.match(skipped[0].reason ?? "", /claim lost/);

    // Stage 4 — execute under cap, receipt-confirmed:
    //  - the 250-YES balance was clamped to the $100 strategy cap (100 YES);
    //  - the wallet's daily cap saw the CLAMPED USD, before the trade;
    //  - the close resolved only at CONFIRMED (the SENT poll was not enough).
    assert.equal(tradeCalls.length, 1, "one trigger, one trade — never two");
    assert.equal(tradeCalls[0].amountRaw, 100_000_000n, "balance clamped by strategy capUsd");
    assert.equal(tradeCalls[0].direction, "sell");
    assert.equal(tradeCalls[0].outcomeIndex, 0);
    assert.equal(tradeCalls[0].providerEventId, EVT_A);
    assert.deepEqual(ledger.checks, [{ wallet: AGENT_WALLET.address, usd: 100 }]);
    assert.deepEqual(order, ["cap-check:100", "trade"], "cap check precedes the trade");

    const finalRow = strategyRow(armed.id);
    assert.equal(finalRow["status"], "executed");
    assert.ok(finalRow["triggeredAt"] instanceof Date);
    assert.ok(finalRow["executedAt"] instanceof Date);

    // Stage 4b — the audit trail answers the whole story from the DB:
    // armed → triggered (once) → executed with the CONFIRMED tx hash.
    const trail = auditFor(armed.id);
    assert.deepEqual(
      trail.map((r) => `${r.action}/${r.outcome}`),
      ["strategy_arm/armed", "strategy_trigger/triggered", "strategy_execute/executed"],
      "exactly one trigger row (claim-once) and one executed row",
    );
    const executedRow = trail[2];
    assert.equal(executedRow.txHash, TX_CONFIRMED);
    assert.match(trail[1].reason ?? "", /take-profit: implied 8500bps >= 8000bps/);
  });

  it("holds the close on an exhausted daily cap — released with NO attempt consumed", async () => {
    const EVT_B = "401e2eb";
    const [MARKET_B] = marketIdsFor(EVT_B);
    const slates = [slateOf([event({ providerEventId: EVT_B })])];
    const config: StrategyConfig = strategyConfigSchema.parse({
      kind: "take-profit-stop",
      marketId: MARKET_B,
      side: "yes",
      takeProfitBps: 8000,
    });
    const armed = await armStrategy(db, USER_ID, config, 100, null);
    joinedMarkets.push({
      marketId: MARKET_B,
      yesToken: "0xyes00000000000000000000000000000000000b",
      outcomeIndex: 0,
      providerEventId: EVT_B,
    });

    const ledger = makeDailyLedger(0); // no headroom left today
    const { deps: execDeps, tradeCalls } = makeExecDeps({
      balance: 50_000_000n,
      ledger,
      circleStates: [{ state: "CONFIRMED", txHash: TX_CONFIRMED }],
      pollTimeoutMs: 2_000,
    });

    const results = await sweep(
      slates,
      () => Promise.resolve({ kind: "price", bps: 8500 }),
      engineDeps(execDeps),
      armed.id,
    );
    assert.equal(results[0].decision, "trigger");
    assert.equal(results[0].execution, "released");
    assert.match(results[0].reason ?? "", /daily spending cap/);
    assert.equal(tradeCalls.length, 0, "a cap block never reaches the trade executor");

    const row = strategyRow(armed.id);
    assert.equal(
      row["status"],
      "armed",
      "released back for a later tick (cap resets at UTC midnight)",
    );
    assert.equal(row["executeAttempts"], 0, "a cap-hold consumes NO attempt");
  });

  it("a Circle execution that never leaves SENT is a counted failure; attempts stop at 3 and the strategy disarms execute-failed", async () => {
    const EVT_C = "401e2ec";
    const [MARKET_C] = marketIdsFor(EVT_C);
    const slates = [slateOf([event({ providerEventId: EVT_C })])];
    const config: StrategyConfig = strategyConfigSchema.parse({
      kind: "take-profit-stop",
      marketId: MARKET_C,
      side: "yes",
      takeProfitBps: 8000,
    });
    const armed = await armStrategy(db, USER_ID, config, 100, null);
    joinedMarkets.push({
      marketId: MARKET_C,
      yesToken: "0xyes00000000000000000000000000000000000c",
      outcomeIndex: 0,
      providerEventId: EVT_C,
    });

    const ledger = makeDailyLedger(500);
    const { deps: execDeps, tradeCalls } = makeExecDeps({
      balance: 50_000_000n,
      ledger,
      // Broadcast (SENT + hash) but never mined: the real pollReceipt must
      // refuse to call this success and time out instead (C-015).
      circleStates: [{ state: "SENT", txHash: TX_BROADCAST_ONLY }],
      pollTimeoutMs: 40,
    });
    const deps = engineDeps(execDeps);
    const readPrice = (): Promise<{ kind: "price"; bps: number }> =>
      Promise.resolve({ kind: "price" as const, bps: 8500 });

    let firstTriggeredAt: unknown;
    for (let attempt = 1; attempt <= MAX_EXECUTE_ATTEMPTS; attempt++) {
      const [result] = await sweep(slates, readPrice, deps, armed.id);
      const row = strategyRow(armed.id);
      if (attempt < MAX_EXECUTE_ATTEMPTS) {
        assert.equal(result.execution, "released", `attempt ${String(attempt)} releases for retry`);
        assert.equal(row["status"], "armed");
        assert.equal(row["executeAttempts"], attempt, "each SENT-stuck poll counts one attempt");
        if (attempt === 1) firstTriggeredAt = row["triggeredAt"];
        else
          assert.equal(
            row["triggeredAt"],
            firstTriggeredAt,
            "first trigger time survives re-claims",
          );
      } else {
        assert.equal(result.execution, "disarmed", "the bound ends the retries");
        assert.equal(row["status"], "disarmed");
        assert.equal(row["disarmedReason"], "execute-failed");
        assert.equal(row["executeAttempts"], MAX_EXECUTE_ATTEMPTS);
      }
    }

    assert.equal(tradeCalls.length, MAX_EXECUTE_ATTEMPTS, "exactly three bounded attempts");
    const trail = auditFor(armed.id);
    assert.equal(
      trail.filter((r) => r.action === "strategy_execute" && r.outcome === "executed").length,
      0,
      "a broadcast-only transaction must never be recorded as executed",
    );
    const disarm = trail.find((r) => r.action === "strategy_auto_disarm");
    assert.ok(disarm, "the give-up is audited");
    assert.match(disarm.reason ?? "", /execute-failed after 3 attempts/);
    assert.match(disarm.reason ?? "", /did not reach a terminal state/);
    // The engine never released the loop early: no armed row remains.
    assert.equal(
      (await listArmed(db)).some((r) => r.id === armed.id),
      false,
    );
  });

  it("stays armed and executes DURING the game (D-103 in-play) — kickoff no longer disarms", async () => {
    const EVT_E = "401e2ee";
    const [MARKET_E] = marketIdsFor(EVT_E);
    // Kickoff has passed and the game is LIVE — under in-play trading this
    // is exactly the window hedging exists for.
    const slates = [
      slateOf([event({ providerEventId: EVT_E, startsAt: NOW - 60, status: "in_progress" })]),
    ];
    const config: StrategyConfig = strategyConfigSchema.parse({
      kind: "take-profit-stop",
      marketId: MARKET_E,
      side: "yes",
      takeProfitBps: 8000,
    });
    const armed = await armStrategy(db, USER_ID, config, 100, null);
    joinedMarkets.push({
      marketId: MARKET_E,
      yesToken: "0xyes00000000000000000000000000000000000e",
      outcomeIndex: 0,
      providerEventId: EVT_E,
    });

    const ledger = makeDailyLedger(500);
    const { deps: execDeps, tradeCalls } = makeExecDeps({
      balance: 50_000_000n,
      ledger,
      circleStates: [{ state: "CONFIRMED", txHash: TX_CONFIRMED }],
      pollTimeoutMs: 2_000,
    });
    // The live pool runs past take-profit MID-GAME: the strategy fires and
    // the close executes — in-play means armed through the whistle.
    const [result] = await sweep(
      slates,
      () => Promise.resolve({ kind: "price", bps: 8500 }),
      engineDeps(execDeps),
      armed.id,
    );
    assert.equal(result.decision, "trigger");
    assert.equal(result.execution, "executed");
    assert.equal(tradeCalls.length, 1, "the in-play trigger reaches the executor");
    assert.equal(strategyRow(armed.id)["status"], "executed");
  });

  it("disarms on the freeze tick — a take-profit-crossing price past the event's end produces zero executions and zero spend", async () => {
    const EVT_D = "401e2ed";
    const [MARKET_D] = marketIdsFor(EVT_D);
    // D-103's freeze is state-driven: a reported FINAL disarms as
    // market-resolved (strategies.test.ts covers that leg); THIS leg
    // exercises the permissionless time backstop — the feed never reported
    // a final, but `startsAt + MAX_EVENT_DURATION_SECONDS` elapsed, so the
    // market is frozen no matter what the feed says.
    const slates = [
      slateOf([
        event({
          providerEventId: EVT_D,
          startsAt: NOW - MAX_EVENT_DURATION_SECONDS,
          status: "in_progress", // feed stuck mid-game — the backstop wins
          homeWinProbabilityBps: 9000, // way past take-profit — must NOT matter
        }),
      ]),
    ];
    const config: StrategyConfig = strategyConfigSchema.parse({
      kind: "take-profit-stop",
      marketId: MARKET_D,
      side: "yes",
      takeProfitBps: 8000,
    });
    const armed = await armStrategy(db, USER_ID, config, 100, null);
    joinedMarkets.push({
      marketId: MARKET_D,
      yesToken: "0xyes00000000000000000000000000000000000d",
      outcomeIndex: 0,
      providerEventId: EVT_D,
    });

    const ledger = makeDailyLedger(500);
    const { deps: execDeps, tradeCalls } = makeExecDeps({
      balance: 50_000_000n,
      ledger,
      circleStates: [{ state: "CONFIRMED", txHash: TX_CONFIRMED }],
      pollTimeoutMs: 2_000,
    });
    let poolReads = 0;
    const [result] = await sweep(
      slates,
      () => {
        poolReads += 1;
        return Promise.resolve({ kind: "price", bps: 9000 });
      },
      engineDeps(execDeps),
      armed.id,
    );

    assert.deepEqual(result, { id: armed.id, decision: "disarm", reason: "market-frozen" });
    assert.equal(poolReads, 0, "a frozen event must not even cost a pool-price read");
    const row = strategyRow(armed.id);
    assert.equal(row["status"], "disarmed");
    assert.equal(row["disarmedReason"], "market-frozen");
    assert.equal(row["triggeredAt"], null, "freeze precedence: no claim ever happened");
    assert.equal(tradeCalls.length, 0, "zero executions after freeze");
    assert.equal(ledger.checks.length, 0, "zero spend-guard activity after freeze");
    assert.deepEqual(
      auditFor(armed.id).map((r) => `${r.action}/${r.outcome}`),
      ["strategy_arm/armed", "strategy_auto_disarm/disarmed"],
    );

    // A later trigger arriving after the freeze finds nothing to fire: the
    // engine sweep no longer sees the strategy at all.
    assert.equal(
      (await listArmed(db)).some((r) => r.id === armed.id),
      false,
    );
    const [again] = await sweep(
      slates,
      () => Promise.resolve({ kind: "price", bps: 9500 }),
      engineDeps(execDeps),
      armed.id,
    );
    assert.equal(again, undefined, "a disarmed strategy is out of the sweep entirely");
    assert.equal(tradeCalls.length, 0);
    assert.equal(ledger.checks.length, 0);
  });
});
