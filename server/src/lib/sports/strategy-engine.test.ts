import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  overlayPoolTicks,
  processStrategy,
  referencedMarketIds,
  type EngineDeps,
  type PoolPriceRead,
} from "./strategy-engine.ts";
import { releaseDisposition, MAX_EXECUTE_ATTEMPTS } from "./strategy-store.ts";
import { ticksFromSlates, type MarketTick, type StrategyConfig } from "./strategies.ts";
import { marketIdsFor } from "./resolution.ts";
import type { HedgeStrategy } from "../../db/schema/markets.ts";
import type { ExecuteOutcome } from "./strategy-execute.ts";
import type { DB } from "../../db/client.ts";
import type { ProviderEvent, ProviderSlate, ProviderTeam } from "./provider.ts";

const NOW = 1_800_000_000;
const DB_STUB = {} as DB; // the injected deps never touch it

// ─── Fixtures ───────────────────────────────────────────────────────────────

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

function slate(events: ProviderEvent[], delayed = false): ProviderSlate {
  return { provider: "espn", league: "nfl", events, delayed, fetchedAt: NOW };
}

const EVENT_ID = "401crown";
const [HOME_MARKET, AWAY_MARKET] = marketIdsFor(EVENT_ID);

const tpStop: StrategyConfig = {
  kind: "take-profit-stop",
  marketId: HOME_MARKET,
  side: "yes",
  takeProfitBps: 8000,
  stopBps: 3000,
};

function row(overrides: Partial<HedgeStrategy> = {}): HedgeStrategy {
  return {
    id: "stg_1",
    userId: "usr_1",
    config: tpStop,
    capUsd: "100",
    expiresAt: null,
    executeAttempts: 0,
    status: "armed",
    ...overrides,
  } as HedgeStrategy;
}

function tick(overrides: Partial<MarketTick> = {}): MarketTick {
  return {
    marketId: HOME_MARKET,
    impliedProbBps: 5000,
    frozen: false,
    resolved: false,
    ...overrides,
  };
}

/** Deps whose every call is recorded; each is overridable per test. */
function makeDeps(overrides: {
  claimWins?: boolean;
  execOutcome?: ExecuteOutcome;
  execThrows?: Error;
  releaseResult?: "released" | "disarmed" | "lost";
}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const named = (fn: string) => calls.filter((c) => c.fn === fn);
  const deps: EngineDeps = {
    disarm: (_db, id, reason) => {
      calls.push({ fn: "disarm", args: [id, reason] });
      return Promise.resolve();
    },
    claim: (_db, id, detail, reason) => {
      calls.push({ fn: "claim", args: [id, detail, reason] });
      return Promise.resolve(overrides.claimWins === false ? null : row({ status: "triggered" }));
    },
    markExecuted: (_db, id, detail, txHash) => {
      calls.push({ fn: "markExecuted", args: [id, detail, txHash] });
      return Promise.resolve(true);
    },
    release: (_db, claimed, reason, opts) => {
      calls.push({ fn: "release", args: [claimed, reason, opts] });
      return Promise.resolve(overrides.releaseResult ?? "released");
    },
    auditHeld: (_db, id, detail, reason) => {
      calls.push({ fn: "auditHeld", args: [id, detail, reason] });
      return Promise.resolve();
    },
    execute: () => {
      calls.push({ fn: "execute", args: [] });
      if (overrides.execThrows) return Promise.reject(overrides.execThrows);
      return Promise.resolve(
        overrides.execOutcome ?? {
          kind: "executed",
          txHash: "0xtrade",
          soldRaw: "1000000",
          usdcOutRaw: "990000",
          circleTxId: "c1",
          finalizedBy: "poll",
        },
      );
    },
  };
  return { calls, named, deps };
}

// ─── Pool-price ticks ───────────────────────────────────────────────────────

describe("overlayPoolTicks (B9-005 price ticks)", () => {
  const relevant = new Set([HOME_MARKET.toLowerCase()]);

  it("replaces the provider line with the pool's own price, complement on the away market", async () => {
    const slates = [slate([event({ providerEventId: EVENT_ID })])];
    const ticks = ticksFromSlates(slates, NOW);
    const out = await overlayPoolTicks(ticks, slates, relevant, () =>
      Promise.resolve({ kind: "price", bps: 7200 }),
    );
    const home = out.find((t) => t.marketId === HOME_MARKET);
    const away = out.find((t) => t.marketId === AWAY_MARKET);
    assert.equal(home?.impliedProbBps, 7200);
    assert.equal(away?.impliedProbBps, 2800);
  });

  it("keeps the provider seed when no pool exists — the seed IS the opening price", async () => {
    const slates = [slate([event({ providerEventId: EVENT_ID })])];
    const out = await overlayPoolTicks(ticksFromSlates(slates, NOW), slates, relevant, () =>
      Promise.resolve({ kind: "none" }),
    );
    assert.equal(out.find((t) => t.marketId === HOME_MARKET)?.impliedProbBps, 6000);
  });

  it("drops the price entirely when the pool read failed — nothing may fire on a stale line", async () => {
    const slates = [slate([event({ providerEventId: EVENT_ID })])];
    const out = await overlayPoolTicks(ticksFromSlates(slates, NOW), slates, relevant, () =>
      Promise.resolve({ kind: "unavailable" }),
    );
    assert.equal(out.find((t) => t.marketId === HOME_MARKET)?.impliedProbBps, null);
    assert.equal(out.find((t) => t.marketId === AWAY_MARKET)?.impliedProbBps, null);
  });

  it("reads only events that are live AND referenced by some strategy", async () => {
    // D-103 in-play: a live (in_progress) game is NOT frozen any more —
    // only a FINAL one is out of the read set.
    const frozenEvent = event({ providerEventId: EVENT_ID, status: "final" });
    const unreferenced = event({ providerEventId: "401other" });
    const slates = [slate([frozenEvent, unreferenced])];
    let reads = 0;
    await overlayPoolTicks(ticksFromSlates(slates, NOW), slates, relevant, () => {
      reads += 1;
      return Promise.resolve<PoolPriceRead>({ kind: "price", bps: 5000 });
    });
    assert.equal(reads, 0, "frozen or unreferenced events must not cost a chain read");
  });

  it("does not mutate the input ticks", async () => {
    const slates = [slate([event({ providerEventId: EVENT_ID })])];
    const ticks = ticksFromSlates(slates, NOW);
    await overlayPoolTicks(ticks, slates, relevant, () =>
      Promise.resolve({ kind: "price", bps: 9999 }),
    );
    assert.equal(ticks.find((t) => t.marketId === HOME_MARKET)?.impliedProbBps, 6000);
  });
});

describe("referencedMarketIds", () => {
  it("collects lowercased ids across strategy kinds, skipping unparseable configs", () => {
    const hedge: StrategyConfig = {
      kind: "delta-hedge",
      marketIds: [HOME_MARKET, AWAY_MARKET],
      targetNetUsd: 0,
      bandUsd: 50,
    };
    const ids = referencedMarketIds([
      row(),
      row({ id: "stg_2", config: hedge }),
      row({ id: "stg_3", config: { junk: true } }),
    ]);
    assert.deepEqual(
      [...ids].sort(),
      [HOME_MARKET.toLowerCase(), AWAY_MARKET.toLowerCase()].sort(),
    );
  });
});

// ─── processStrategy ────────────────────────────────────────────────────────

describe("processStrategy — trigger → claim → execute (B9-005)", () => {
  it("claims BEFORE executing, then records executed on a poll-finalized close", async () => {
    const { calls, named, deps } = makeDeps({});
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 8500 })],
      NOW,
      false,
      deps,
    );
    assert.deepEqual(result, { id: "stg_1", decision: "trigger", execution: "executed" });
    assert.deepEqual(
      calls.map((c) => c.fn),
      ["claim", "execute", "markExecuted"],
      "claim must precede execution; executed is recorded last",
    );
    assert.equal(named("markExecuted")[0].args[2], "0xtrade");
  });

  it("skips execution entirely when the claim is lost to a concurrent tick", async () => {
    const { named, deps } = makeDeps({ claimWins: false });
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 8500 })],
      NOW,
      false,
      deps,
    );
    assert.equal(result.decision, "skipped");
    assert.equal(named("execute").length, 0, "the claim loser must never touch money");
    assert.equal(named("markExecuted").length, 0);
  });

  it("does not re-record executed when the webhook finalizer already won (C-015)", async () => {
    const { named, deps } = makeDeps({
      execOutcome: {
        kind: "executed",
        txHash: "0xtrade",
        soldRaw: "1",
        usdcOutRaw: "1",
        circleTxId: "c1",
        finalizedBy: "webhook",
      },
    });
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 8500 })],
      NOW,
      false,
      deps,
    );
    assert.equal(result.execution, "webhook");
    assert.equal(named("markExecuted").length, 0, "the webhook already closed and audited");
  });

  it("a non-retryable hold stays triggered — recorded for the user, no release", async () => {
    const { named, deps } = makeDeps({
      execOutcome: {
        kind: "held",
        reason: "agent wallet holds no position in this market",
        retryable: false,
      },
    });
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 8500 })],
      NOW,
      false,
      deps,
    );
    assert.equal(result.execution, "held");
    assert.equal(named("auditHeld").length, 1, "the wait must be auditable");
    assert.equal(named("release").length, 0, "a user-wallet position waits for the user's click");
  });

  it("a cap-hold releases the claim WITHOUT counting an attempt — retried after reset", async () => {
    const { named, deps } = makeDeps({
      execOutcome: { kind: "held", reason: "daily spending cap reached", retryable: true },
    });
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 8500 })],
      NOW,
      false,
      deps,
    );
    assert.equal(result.execution, "released");
    const release = named("release")[0];
    assert.deepEqual(release.args[2], { countAttempt: false });
  });

  it("a failed close releases with a COUNTED attempt", async () => {
    const { named, deps } = makeDeps({
      execOutcome: { kind: "failed", error: "swap reverted" },
    });
    await processStrategy(DB_STUB, row(), [tick({ impliedProbBps: 8500 })], NOW, false, deps);
    const release = named("release")[0];
    assert.deepEqual(release.args[2], { countAttempt: true });
  });

  it("reports disarmed when the release hit the retry bound", async () => {
    const { deps } = makeDeps({
      execOutcome: { kind: "failed", error: "swap reverted" },
      releaseResult: "disarmed",
    });
    const result = await processStrategy(
      DB_STUB,
      row({ executeAttempts: MAX_EXECUTE_ATTEMPTS - 1 }),
      [tick({ impliedProbBps: 8500 })],
      NOW,
      false,
      deps,
    );
    assert.equal(result.execution, "disarmed");
  });

  it("an executor THROW releases the claim instead of leaving the row stuck", async () => {
    const { named, deps } = makeDeps({ execThrows: new Error("cap ledger connection refused") });
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 8500 })],
      NOW,
      false,
      deps,
    );
    assert.equal(result.execution, "released");
    assert.match(result.reason ?? "", /ledger connection refused/);
    assert.deepEqual(named("release")[0].args[2], { countAttempt: true });
  });
});

describe("processStrategy — safety precedence (B9-007 still holds)", () => {
  it("a market freeze disarms on the very tick that would have fired — no claim, no trade", async () => {
    const { named, deps } = makeDeps({});
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 9000, frozen: true })],
      NOW,
      false,
      deps,
    );
    assert.deepEqual(result, { id: "stg_1", decision: "disarm", reason: "market-frozen" });
    assert.deepEqual(named("disarm")[0].args, ["stg_1", "market-frozen"]);
    assert.equal(named("claim").length, 0);
    assert.equal(named("execute").length, 0);
  });

  it("the global kill switch disarms without evaluating triggers", async () => {
    const { named, deps } = makeDeps({});
    const result = await processStrategy(
      DB_STUB,
      row(),
      [tick({ impliedProbBps: 9000 })],
      NOW,
      true,
      deps,
    );
    assert.equal(result.reason, "kill-switch");
    assert.equal(named("execute").length, 0);
  });

  it("an unparseable stored config auto-disarms rather than executing on garbage", async () => {
    const { named, deps } = makeDeps({});
    const result = await processStrategy(
      DB_STUB,
      row({ config: { kind: "mystery" } }),
      [tick()],
      NOW,
      false,
      deps,
    );
    assert.deepEqual(result, { id: "stg_1", decision: "disarm", reason: "config-unparseable" });
    assert.equal(named("claim").length, 0);
  });

  it("holds quietly inside thresholds — no writes at all", async () => {
    const { calls, deps } = makeDeps({});
    const result = await processStrategy(DB_STUB, row(), [tick()], NOW, false, deps);
    assert.equal(result.decision, "hold");
    assert.deepEqual(calls, []);
  });
});

describe("releaseDisposition — bounded retries", () => {
  it("counts failures up to the bound, then disarms", () => {
    assert.deepEqual(releaseDisposition(0, true), { next: "armed", attempts: 1 });
    assert.deepEqual(releaseDisposition(MAX_EXECUTE_ATTEMPTS - 2, true), {
      next: "armed",
      attempts: MAX_EXECUTE_ATTEMPTS - 1,
    });
    assert.deepEqual(releaseDisposition(MAX_EXECUTE_ATTEMPTS - 1, true), {
      next: "disarmed",
      attempts: MAX_EXECUTE_ATTEMPTS,
    });
  });

  it("a cap-hold never consumes an attempt and never disarms below the bound", () => {
    assert.deepEqual(releaseDisposition(MAX_EXECUTE_ATTEMPTS - 1, false), {
      next: "armed",
      attempts: MAX_EXECUTE_ATTEMPTS - 1,
    });
  });
});
