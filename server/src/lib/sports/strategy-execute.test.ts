import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeLegUsd, executeTriggeredClose, type ExecuteCloseDeps } from "./strategy-execute.ts";
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

  it("holds the close when the wallet is capped out — no trade fires", async () => {
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
    assert.deepEqual(calls, [], "a cap block never reaches the trade executor");
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
