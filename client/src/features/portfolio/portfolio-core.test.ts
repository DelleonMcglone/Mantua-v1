import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateHoldings,
  gameLabel,
  groupPositionsByGame,
  payoutLine,
  settledLine,
  settledOutcome,
  sumMarketValueUsd,
  sumUsd,
  type MarketPositionRow,
} from "./portfolio-core.ts";

const row = (over: Partial<MarketPositionRow>): MarketPositionRow => ({
  marketId: "0xm",
  label: "Atlanta Falcons to beat New Orleans Saints",
  state: "OPEN",
  side: "yes",
  balance: "16000000",
  impliedProbBps: 6600,
  valueRaw: "10560000",
  league: "nfl",
  providerEventId: "401",
  entryPriceBps: 6250,
  pnlRaw: "560000",
  potentialPayoutRaw: "16000000",
  ...over,
});

void describe("market positions", () => {
  void it("groups by game with summed value and payout, and names the game", () => {
    const groups = groupPositionsByGame([
      row({}),
      row({
        marketId: "0xn",
        side: "no",
        balance: "4000000",
        valueRaw: "1360000",
        potentialPayoutRaw: "4000000",
      }),
      row({
        marketId: "0xo",
        providerEventId: "402",
        label: "Giants to beat Jets",
        valueRaw: "2000000",
        potentialPayoutRaw: "5000000",
      }),
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.label, "Atlanta Falcons vs New Orleans Saints");
    assert.equal(groups[0]?.rows.length, 2);
    assert.equal(groups[0]?.valueUsd, 11.92);
    assert.equal(groups[0]?.potentialPayoutUsd, 20);
    assert.equal(gameLabel("Giants to beat Jets"), "Giants vs Jets");
    assert.equal(gameLabel("Custom market"), "Custom market");
  });

  void it("writes the payout line per side and sums mark value", () => {
    assert.equal(payoutLine(row({})), "pays $16.00 if it wins");
    assert.equal(
      payoutLine(row({ side: "no", potentialPayoutRaw: "4000000" })),
      "pays $4.00 if it loses",
    );
    assert.equal(sumMarketValueUsd([row({}), row({ valueRaw: "1000000" })]), 11.56);
  });
});

void describe("holdings aggregate", () => {
  void it("adds every readable source, lists what could not be read, and drops zero parts", () => {
    const s = aggregateHoldings({
      userWalletUsd: 120.5,
      agentWalletUsd: 30,
      unifiedBalanceUsd: null,
      marketPositionsUsd: 11.92,
      lpPositionsUsd: 0,
    });
    assert.equal(s.totalUsd, 162.42);
    assert.deepEqual(
      s.parts.map((p) => p.label),
      ["Wallet", "Agent wallet", "Market positions"],
    );
    assert.deepEqual(s.missing, ["Unified balance"]);
  });

  void it("sums usdValue fields whether numbers or strings", () => {
    assert.equal(
      sumUsd([{ usdValue: 1.5 }, { usdValue: "2.25" }, { usdValue: null }, { usdValue: "x" }]),
      3.75,
    );
  });
});

void describe("settled history", () => {
  void it("labels the outcome and writes the money line", () => {
    const win = {
      marketId: "0xm",
      label: "Falcons to beat Saints",
      league: "nfl",
      status: "resolved_win",
      costUsd: 10,
      proceedsUsd: 0,
      payoutUsd: 16,
      realizedPnlUsd: 6,
      resolvedAt: null,
      redeemed: true,
    };
    assert.deepEqual(settledOutcome(win), { label: "Won", tone: "win" });
    assert.equal(settledLine(win), "cost $10.00 · paid $16.00 · +$6.00");
    const loss = {
      ...win,
      status: "resolved_loss",
      payoutUsd: 0,
      proceedsUsd: 1.5,
      realizedPnlUsd: -8.5,
    };
    assert.deepEqual(settledOutcome(loss), { label: "Lost", tone: "loss" });
    assert.equal(settledLine(loss), "cost $10.00 · sold $1.50 · −$8.50");
    assert.equal(settledOutcome({ ...win, status: "voided" }).label, "Voided");
  });
});
