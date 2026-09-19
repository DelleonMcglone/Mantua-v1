import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeAction,
  hedgeAmountRaw,
  planComboManagement,
  type MonitoredLeg,
  type MonitoredTicket,
} from "./combo-monitor.ts";

/** Task 072 / CB-009 — what the monitor may do with an open ticket. */

const legA: MonitoredLeg = {
  marketId: "0xa",
  providerEventId: "1",
  outcomeIndex: 0,
  teamName: "A",
  result: "won",
  priceBps: 10_000,
};
const legB: MonitoredLeg = {
  marketId: "0xb",
  providerEventId: "2",
  outcomeIndex: 1,
  teamName: "B",
  result: "pending",
  priceBps: 7_000,
};
const ticket = (over: Partial<MonitoredTicket>): MonitoredTicket => ({
  comboId: "t1",
  status: "open",
  stakeRaw: 10_000_000n,
  markBps: 6_500,
  legs: [legA, legB],
  ...over,
});
const policy = { takeProfitBps: 8_000 };

void describe("planComboManagement", () => {
  void it("marks a ticket dead once, then holds", () => {
    const dead = { ...legB, result: "lost" as const };
    assert.equal(planComboManagement(ticket({ legs: [legA, dead] }), policy).kind, "mark_dead");
    assert.equal(
      planComboManagement(ticket({ legs: [legA, dead], status: "dead" }), policy).kind,
      "hold",
    );
  });
  void it("holds when every leg is decided or the mark is unreadable", () => {
    assert.equal(
      planComboManagement(ticket({ legs: [legA, { ...legB, result: "won" }] }), policy).kind,
      "hold",
    );
    assert.equal(planComboManagement(ticket({ markBps: null }), policy).kind, "hold");
  });
  void it("takes profit at the policy line", () => {
    const a = planComboManagement(ticket({ markBps: 8_000 }), policy);
    assert.equal(a.kind, "take_profit");
  });
  void it("hedges the last pending leg in its own market, sized to recover the stake", () => {
    const a = planComboManagement(ticket({}), policy);
    assert.equal(a.kind, "hedge_leg");
    assert.equal(a.hedgeOutcomeIndex, 0);
    assert.equal(a.amountRaw, 3_000_000n);
    assert.match(describeAction(a), /Hedge B for 3\.00 USDC/);
  });
  void it("holds with two legs pending or below the hedge floor", () => {
    const c: MonitoredLeg = { ...legB, marketId: "0xc", providerEventId: "3", teamName: "C" };
    assert.equal(planComboManagement(ticket({ legs: [legA, legB, c] }), policy).kind, "hold");
    assert.equal(planComboManagement(ticket({ markBps: 4_000 }), policy).kind, "hold");
    assert.equal(
      planComboManagement(ticket({ legs: [legA, { ...legB, priceBps: null }] }), policy).kind,
      "hold",
    );
  });
  void it("hedge cost is stake × the opponent's price, clamped", () => {
    assert.equal(hedgeAmountRaw(10_000_000n, 7_000), 3_000_000n);
    assert.equal(hedgeAmountRaw(10_000_000n, 10_000), 1_000n);
    assert.equal(hedgeAmountRaw(10_000_000n, 0), 9_999_000n);
  });
});
