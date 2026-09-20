import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executionRow,
  fillRow,
  portfolioRow,
  spendRow,
  withdrawalRow,
} from "./custody-statement-rows.ts";

/** Task 073 / IC-002 — ledger rows become statement lines with USD amounts. */

const at = new Date("2026-09-02T10:00:00.000Z");

void describe("statement rows", () => {
  void it("a fill: USDC raw and the fee raw scaled to dollars", () => {
    const r = fillRow({
      address: "0xAAA",
      direction: "buy",
      usdcRaw: "40000000",
      feeUsdcRaw: "500000",
      txHash: "0xt",
      marketId: "0xm",
      createdAt: at,
    });
    assert.deepEqual(r, {
      at: "2026-09-02T10:00:00.000Z",
      kind: "fill",
      wallet: "0xaaa",
      reference: "0xt",
      amountUsd: 40,
      feeUsd: 0.5,
      detail: "buy 0xm",
    });
    assert.equal(
      fillRow({
        ...r,
        address: "0xa",
        direction: "sell",
        usdcRaw: "1",
        feeUsdcRaw: null,
        txHash: "0x",
        marketId: "m",
        createdAt: at,
      }).feeUsd,
      null,
    );
  });
  void it("a portfolio transaction: a send is a send, anything else an execution", () => {
    const send = portfolioRow({
      walletAddress: "0xa",
      action: "send",
      txHash: "0x1",
      usdValue: "12.50",
      createdAt: at,
    });
    assert.equal(send.kind, "send");
    assert.equal(send.amountUsd, 12.5);
    const swap = portfolioRow({
      walletAddress: "0xa",
      action: "swap",
      txHash: "0x2",
      usdValue: null,
      createdAt: at,
    });
    assert.equal(swap.kind, "execution");
    assert.equal(swap.amountUsd, null);
    assert.equal(swap.detail, "swap");
  });
  void it("a non-confirmed Circle execution carries its status and payload value", () => {
    const r = executionRow({
      walletAddress: "0xa",
      kind: "agent_send",
      action: "agent_send",
      status: "failed",
      circleTxId: "ctx",
      createdAt: at,
      payload: { usdValue: 3 },
    });
    assert.equal(r.reference, "ctx");
    assert.equal(r.amountUsd, 3);
    assert.equal(r.detail, "agent_send failed");
    assert.equal(
      executionRow({
        walletAddress: null,
        kind: "k",
        action: "a",
        status: "pending",
        circleTxId: "c",
        createdAt: at,
        payload: {},
      }).wallet,
      "",
    );
  });
  void it("a withdrawal names its destination and status; a spend day its count", () => {
    const w = withdrawalRow(
      {
        id: "w1",
        walletAddress: "0xa",
        status: "executed",
        usdValue: "1500.00",
        amount: "1500",
        symbol: "USDC",
        createdAt: at,
      },
      "Anchorage",
    );
    assert.equal(w.kind, "withdrawal");
    assert.equal(w.amountUsd, 1500);
    assert.equal(w.detail, "executed 1500 USDC → Anchorage");
    const s = spendRow({
      walletAddress: "0xa",
      spendDate: "2026-09-02",
      spentUsd: "40.00",
      txCount: 2,
    });
    assert.equal(s.at, "2026-09-02T00:00:00.000Z");
    assert.equal(s.detail, "2 transactions");
  });
});
