import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeLegUsd, executeTriggeredClose, type ExecuteCloseDeps } from "./strategy-execute.ts";
import { DEFAULT_POLICY } from "../agent/policy.ts";

/** Task 057 — the default (permissive-enough) policy context; tests that
 *  exercise the policy gate override it. */
const OPEN_POLICY: NonNullable<ExecuteCloseDeps["hedgeContext"]> = () =>
  Promise.resolve({
    view: {
      ...DEFAULT_POLICY,
      hedge: { ...DEFAULT_POLICY.hedge, maxSizeUsd: 10_000, dailyBudgetUsd: 10_000 },
    },
    lastHedgeAtMs: null,
    spentTodayUsd: 0,
  });
import type { HedgeStrategy } from "../../db/schema/markets.ts";
import type { StrategyDecision } from "./strategies.ts";
import { SafetyError } from "../errors.ts";
import type { DB } from "../../db/client.ts";

const WALLET = {
  circleWalletId: "cw_1",
  address: "0xabc0000000000000000000000000000000000001",
};

/** Minimal market + wallet rows the executor's two selects expect. */
function fakeDb(market: unknown, wallet: unknown): DB {
  const rows = (result: unknown) => {
    const p = Promise.resolve([result]);
    return Object.assign(p, { limit: () => p });
  };
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => rows(market),
        }),
        where: () => rows(wallet),
      }),
    }),
  } as unknown as DB;
}

const STRATEGY = {
  id: "stg_1",
  userId: "usr_1",
  capUsd: "500",
} as unknown as HedgeStrategy;

const DECISION = {
  kind: "trigger",
  action: "close-position",
  marketId: "mkt_1",
} as unknown as Extract<StrategyDecision, { kind: "trigger" }>;

const MARKET = {
  yesToken: "0xyes",
  outcomeIndex: 1,
  providerEventId: "ev_1",
};

const BALANCE = 2_000_000n; // 2 YES tokens

function makeDeps(overrides: {
  checkSpendingCap?: ExecuteCloseDeps["checkSpendingCap"];
  agentMarketTrade?: ExecuteCloseDeps["agentMarketTrade"];
}) {
  const calls: string[] = [];
  const deps: ExecuteCloseDeps = {
    balanceOf: () => Promise.resolve(BALANCE),
    hedgeContext: OPEN_POLICY,
    checkSpendingCap:
      overrides.checkSpendingCap ??
      (() => {
        calls.push("check");
        return Promise.resolve();
      }),
    agentMarketTrade:
      overrides.agentMarketTrade ??
      ((args) => {
        calls.push("trade");
        void args;
        return Promise.resolve({
          txHash: "0xtrade",
          circleTxId: "c1",
          finalizedBy: "poll",
          marketId: "0xmkt1",
          quote: { amountIn: "2000000", amountOut: "1980000", effectivePriceBps: null },
        });
      }),
  };
  return { calls, deps };
}

describe("closeLegUsd", () => {
  it("bounds the close leg's USD value by the 1-USDC redemption ceiling", () => {
    assert.equal(closeLegUsd(2_000_000n), 2);
    assert.equal(closeLegUsd(1n), 0.000001);
  });
});

describe("executeTriggeredClose (C-019 cron daily cap)", () => {
  it("checks the wallet's daily cap before trading, in that order", async () => {
    const { calls, deps } = makeDeps({});
    const outcome = await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, deps);
    assert.equal(outcome.kind, "executed");
    assert.deepEqual(calls, ["check", "trade"], "cap check precedes the trade");
  });

  it("feeds the cap the close leg's USD magnitude for the wallet", async () => {
    let seen: { wallet: string; usd: number } | undefined;
    const { deps } = makeDeps({
      checkSpendingCap: (wallet, usd) => {
        seen = { wallet, usd };
        return Promise.resolve();
      },
    });
    await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, deps);
    assert.ok(seen, "cap check never ran");
    assert.equal(seen.wallet, WALLET.address);
    assert.equal(seen.usd, 2);
  });

  it("holds the close when the wallet is capped out — no trade fires, and it is retryable", async () => {
    const { calls, deps } = makeDeps({
      checkSpendingCap: () =>
        Promise.reject(
          new SafetyError("spending_cap_exceeded", "daily spending cap reached", {
            cap: 50,
            spent: 51.5,
            usdAmount: 2,
          }),
        ),
    });
    const outcome = await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, deps);
    assert.equal(outcome.kind, "held");
    assert.match(outcome.reason, /daily spending cap/);
    // The daily cap resets at UTC midnight, so the engine may release the
    // claim and retry on a later tick — unlike the waits below.
    assert.equal(outcome.retryable, true);
    assert.deepEqual(calls, [], "a cap block never reaches the trade executor");
  });

  it("both caps bind — the strategy cap clamps the leg BEFORE the daily cap sees it", async () => {
    // Balance is 2 YES (≤ $2), but the strategy's own cap is $0.75: the
    // tighter bound wins, so the trade and the daily-cap check both see
    // 0.75 — never the full balance.
    let capSawUsd: number | undefined;
    let tradedRaw: bigint | undefined;
    const { deps } = makeDeps({
      checkSpendingCap: (_wallet, usd) => {
        capSawUsd = usd;
        return Promise.resolve();
      },
      agentMarketTrade: (args) => {
        tradedRaw = args.amountRaw;
        return Promise.resolve({
          txHash: "0xtrade",
          circleTxId: "c1",
          finalizedBy: "poll",
          marketId: "0xmkt1",
          quote: { amountIn: "750000", amountOut: "740000", effectivePriceBps: null },
        });
      },
    });
    const capped = { ...STRATEGY, capUsd: "0.75" };
    const outcome = await executeTriggeredClose(fakeDb(MARKET, WALLET), capped, DECISION, deps);
    assert.equal(outcome.kind, "executed");
    assert.equal(capSawUsd, 0.75);
    assert.equal(tradedRaw, 750_000n);
  });

  it("a user-wallet position (agent holds nothing) waits — held, NOT retryable", async () => {
    const { deps } = makeDeps({});
    deps.balanceOf = () => Promise.resolve(0n);
    const outcome = await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, deps);
    assert.equal(outcome.kind, "held");
    assert.equal(outcome.retryable, false);
    assert.match(outcome.reason, /no position/);
  });

  it("a delta-hedge rebalance trigger is held, NOT retryable — recorded for the dashboard", async () => {
    const { calls, deps } = makeDeps({});
    const rebalance = { ...DECISION, action: "rebalance" } as typeof DECISION;
    const outcome = await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, rebalance, deps);
    assert.equal(outcome.kind, "held");
    assert.equal(outcome.retryable, false);
    assert.deepEqual(calls, []);
  });

  it("a trade failure reports failed with the error — the engine bounds the retries", async () => {
    const { deps } = makeDeps({
      agentMarketTrade: () => Promise.reject(new Error("swap reverted: FROZEN")),
    });
    const outcome = await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, deps);
    assert.equal(outcome.kind, "failed");
    assert.match(outcome.error, /FROZEN/);
  });

  it("does not swallow a cap-ledger outage — that is not a strategy decision", async () => {
    const { deps } = makeDeps({
      checkSpendingCap: () => Promise.reject(new Error("ledger connection refused")),
    });
    await assert.rejects(
      executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, deps),
      /ledger connection refused/,
    );
  });
});

void describe("task 057 — the user's hedge policy (D-109) gates and clamps the close", () => {
  const BASE_VIEW = {
    status: "active" as const,
    autoTradeEnabled: false,
    maxStakePerTradeUsd: 25,
    riskLevel: "conservative" as const,
    allowedLeagues: [],
    hedge: {
      maxSizeUsd: 1,
      maxExposureUsd: 100,
      minConfidenceBps: 0,
      cooldownMinutes: 0,
      dailyBudgetUsd: 100,
      allowedMarketTypes: [],
    },
    combo: DEFAULT_POLICY.combo,
    updatedAt: null,
    persisted: true,
  };

  void it("a paused policy holds non-retryably before the cap ledger is touched", async () => {
    let capChecked = false;
    const out = await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, {
      balanceOf: () => Promise.resolve(BALANCE),
      checkSpendingCap: () => {
        capChecked = true;
        return Promise.resolve();
      },
      agentMarketTrade: () => Promise.reject(new Error("must not execute")),
      hedgeContext: () =>
        Promise.resolve({
          view: { ...BASE_VIEW, status: "paused" as const },
          lastHedgeAtMs: null,
          spentTodayUsd: 0,
        }),
    });
    assert.equal(out.kind, "held");
    assert.equal(out.retryable, false);
    assert.match(out.reason, /policy: the agent's policy is paused/);
    assert.equal(capChecked, false);
  });

  void it("the policy's max size clamps the leg below the strategy cap and the balance", async () => {
    let traded: bigint | null = null;
    const out = await executeTriggeredClose(fakeDb(MARKET, WALLET), STRATEGY, DECISION, {
      balanceOf: () => Promise.resolve(BALANCE),
      checkSpendingCap: () => Promise.resolve(),
      agentMarketTrade: (args) => {
        traded = args.amountRaw;
        return Promise.reject(new Error("stop here"));
      },
      hedgeContext: () =>
        Promise.resolve({ view: BASE_VIEW, lastHedgeAtMs: null, spentTodayUsd: 0 }),
    });
    assert.notEqual(out.kind, "executed");
    assert.equal(traded, 1_000_000n, "2 YES held, $500 strategy cap, $1 policy max → 1 YES");
  });
});
