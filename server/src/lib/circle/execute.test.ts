import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TransactionState } from "@circle-fin/developer-controlled-wallets";
import {
  CircleReceiptTimeoutError,
  CircleTransactionFailedError,
  isTerminalFailureState,
  isTerminalSuccessState,
  pollReceipt,
} from "./execute.ts";

const HASH = `0x${"ab".repeat(32)}`;

type GetTransaction = Parameters<typeof pollReceipt>[1];

function txResponse(state: TransactionState, overrides: Record<string, unknown> = {}) {
  return {
    data: { transaction: { state, txHash: HASH, errorReason: null, ...overrides } },
  };
}

function returning(response: () => unknown): GetTransaction {
  return () => Promise.resolve(response() as never);
}

describe("Circle terminal-state predicates", () => {
  it("treats CONFIRMED and COMPLETE as terminal success", () => {
    assert.equal(isTerminalSuccessState("CONFIRMED"), true);
    assert.equal(isTerminalSuccessState("COMPLETE"), true);
  });

  it("treats SENT and STUCK as non-terminal", () => {
    assert.equal(isTerminalSuccessState("SENT"), false);
    assert.equal(isTerminalSuccessState("STUCK"), false);
  });

  it("treats FAILED, CANCELLED and DENIED as terminal failure", () => {
    assert.equal(isTerminalFailureState("FAILED"), true);
    assert.equal(isTerminalFailureState("CANCELLED"), true);
    assert.equal(isTerminalFailureState("DENIED"), true);
    assert.equal(isTerminalFailureState("CONFIRMED"), false);
  });
});

describe("pollReceipt", () => {
  it("resolves only on a confirmed receipt, not on SENT", async () => {
    // D-110 — a txHash at SENT is not a receipt: the poll keeps going
    // until the state is terminal-success.
    const responses = [txResponse("SENT", { txHash: HASH }), txResponse("CONFIRMED")];
    const result = await pollReceipt(
      "tx1",
      () => Promise.resolve(responses.shift() ?? txResponse("CONFIRMED")),
      { intervalMs: 1, timeoutMs: 1_000 },
    );
    assert.equal(result.txHash, HASH);
    assert.equal(result.state, "CONFIRMED");
  });

  it("keeps polling STUCK until the budget expires, then reports pending", async () => {
    await assert.rejects(
      pollReceipt(
        "tx2",
        returning(() => txResponse("STUCK")),
        {
          intervalMs: 1,
          timeoutMs: 30,
        },
      ),
      CircleReceiptTimeoutError,
    );
  });

  it("raises a typed error on FAILED and reports Circle's reason", async () => {
    try {
      await pollReceipt(
        "tx3",
        returning(() => txResponse("FAILED", { errorReason: "execution reverted" })),
        { intervalMs: 1, timeoutMs: 1_000 },
      );
      assert.fail("expected CircleTransactionFailedError");
    } catch (err) {
      assert.ok(err instanceof CircleTransactionFailedError);
      assert.equal(err.state, "FAILED");
      assert.equal(err.errorReason, "execution reverted");
    }
  });

  it("raises a typed error on CANCELLED", async () => {
    await assert.rejects(
      pollReceipt(
        "tx4",
        returning(() => txResponse("CANCELLED")),
        {
          intervalMs: 1,
          timeoutMs: 1_000,
        },
      ),
      CircleTransactionFailedError,
    );
  });

  it("never returns success without a txHash", async () => {
    await assert.rejects(
      pollReceipt(
        "tx5",
        returning(() => ({
          data: { transaction: { state: "CONFIRMED", txHash: undefined } },
        })),
        { intervalMs: 1, timeoutMs: 1_000 },
      ),
      /without a txHash/,
    );
  });

  it("raises a typed error on DENIED — compliance denial is a failure, not a retry", async () => {
    try {
      await pollReceipt(
        "tx-denied",
        returning(() => txResponse("DENIED", { errorReason: "transaction screening denial" })),
        { intervalMs: 1, timeoutMs: 1_000 },
      );
      assert.fail("expected CircleTransactionFailedError");
    } catch (err) {
      assert.ok(err instanceof CircleTransactionFailedError);
      assert.equal(err.state, "DENIED");
      assert.equal(err.errorReason, "transaction screening denial");
    }
  });

  it("never surfaces a terminal failure as success even when a txHash exists", async () => {
    // A reverted transaction HAS a hash — the hash proves broadcast, not
    // outcome. The poll must still raise the typed failure.
    try {
      await pollReceipt(
        "tx-reverted",
        returning(() => txResponse("FAILED", { txHash: HASH, errorReason: "out of gas" })),
        { intervalMs: 1, timeoutMs: 1_000 },
      );
      assert.fail("expected CircleTransactionFailedError");
    } catch (err) {
      assert.ok(err instanceof CircleTransactionFailedError);
      assert.equal(err.circleTxId, "tx-reverted");
    }
  });

  it("timeout surfaces the typed INDETERMINATE outcome, distinct from failure", async () => {
    // C-012 — a bounded poll ending without a terminal state is PENDING:
    // callers may report neither success nor a definite failure. The error
    // type carries everything a caller needs to hand off to the finalizer.
    try {
      await pollReceipt(
        "tx-pending",
        returning(() => txResponse("QUEUED", { txHash: undefined })),
        { intervalMs: 1, timeoutMs: 30 },
      );
      assert.fail("expected CircleReceiptTimeoutError");
    } catch (err) {
      assert.ok(err instanceof CircleReceiptTimeoutError);
      assert.ok(!(err instanceof CircleTransactionFailedError));
      assert.equal(err.circleTxId, "tx-pending");
      assert.equal(err.timeoutMs, 30);
      // Never got as far as SENT — no hash to hand the finalizer.
      assert.equal(err.txHash, null);
      assert.match(err.message, /outcome pending, not success/);
    }
  });

  it("carries the last observed broadcast hash on timeout", async () => {
    try {
      await pollReceipt(
        "tx6",
        returning(() => txResponse("SENT")),
        {
          intervalMs: 1,
          timeoutMs: 30,
        },
      );
      assert.fail("expected CircleReceiptTimeoutError");
    } catch (err) {
      assert.ok(err instanceof CircleReceiptTimeoutError);
      assert.equal(err.txHash, HASH);
    }
  });

  it("resolves on COMPLETE as terminal success", async () => {
    const result = await pollReceipt(
      "tx7",
      returning(() => txResponse("COMPLETE")),
      {
        intervalMs: 1,
        timeoutMs: 1_000,
      },
    );
    assert.equal(result.state, "COMPLETE");
    assert.equal(result.txHash, HASH);
  });
});
