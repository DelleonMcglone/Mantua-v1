import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_WINDOW_MS,
  duplicateMessage,
  findDuplicateTrade,
  type LedgerRow,
  type TradeIdentity,
} from "./agent-trade-guard.ts";

const NOW = Date.parse("2026-10-29T18:00:00Z");

const WANT: TradeIdentity = {
  providerEventId: "401772938",
  outcomeIndex: 0,
  direction: "buy",
  amountRaw: "25000000",
};

function row(
  overrides: Partial<LedgerRow> & { payload?: Record<string, unknown> } = {},
): LedgerRow {
  return {
    circleTxId: "ctx-1",
    status: "pending",
    createdAt: new Date(NOW - 3 * 60_000),
    ...overrides,
    payload: { agentAddress: `0x${"ab".repeat(20)}`, ...WANT, ...(overrides.payload ?? {}) },
  };
}

describe("findDuplicateTrade", () => {
  it("finds the same trade still pending inside the window", () => {
    const dup = findDuplicateTrade([row()], WANT, NOW);
    assert.deepEqual(dup, { circleTxId: "ctx-1", status: "pending", ageMs: 3 * 60_000 });
  });

  it("finds the same trade already confirmed inside the window", () => {
    const dup = findDuplicateTrade([row({ status: "confirmed" })], WANT, NOW);
    assert.equal(dup?.status, "confirmed");
  });

  it("ignores a failed execution — a reverted trade may be retried", () => {
    assert.equal(findDuplicateTrade([row({ status: "failed" })], WANT, NOW), null);
  });

  it("ignores an execution older than the window", () => {
    const old = row({ createdAt: new Date(NOW - DUPLICATE_WINDOW_MS - 1) });
    assert.equal(findDuplicateTrade([old], WANT, NOW), null);
  });

  it("ignores a trade that differs in any part of its identity", () => {
    assert.equal(
      findDuplicateTrade([row({ payload: { amountRaw: "26000000" } })], WANT, NOW),
      null,
    );
    assert.equal(findDuplicateTrade([row({ payload: { outcomeIndex: 1 } })], WANT, NOW), null);
    assert.equal(findDuplicateTrade([row({ payload: { direction: "sell" } })], WANT, NOW), null);
    assert.equal(findDuplicateTrade([row({ payload: { providerEventId: "1" } })], WANT, NOW), null);
  });

  it("ignores rows whose payload is not an agent trade", () => {
    const stray: LedgerRow = { ...row(), payload: { strategyId: "s1" } };
    assert.equal(findDuplicateTrade([stray], WANT, NOW), null);
  });

  it("returns the newest match first", () => {
    const newest = row({ circleTxId: "ctx-new", createdAt: new Date(NOW - 60_000) });
    const older = row({ circleTxId: "ctx-old", status: "confirmed" });
    assert.equal(findDuplicateTrade([newest, older], WANT, NOW)?.circleTxId, "ctx-new");
  });
});

describe("duplicateMessage", () => {
  it("says a pending trade is still confirming and was not sent again", () => {
    const msg = duplicateMessage({ circleTxId: "c", status: "pending", ageMs: 150_000 }, WANT);
    assert.match(msg, /buy 25\.00 USDC of game 401772938 outcome 0/);
    assert.match(msg, /3 min ago/);
    assert.match(msg, /still confirming/);
    assert.match(msg, /Nothing was executed again/);
  });

  it("says a confirmed trade already went through", () => {
    const msg = duplicateMessage({ circleTxId: "c", status: "confirmed", ageMs: 10_000 }, WANT);
    assert.match(msg, /already went through 1 min ago/);
    assert.match(msg, /change the amount or wait ten minutes/);
  });
});
