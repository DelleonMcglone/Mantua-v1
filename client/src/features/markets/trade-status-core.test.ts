import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_SLOW_AFTER_MS,
  PENDING_UNKNOWN_GIVE_UP_MS,
  classifyTradeError,
  disposePending,
  parsePendingTrades,
  pendingForWallet,
  removePending,
  serializePendingTrades,
  upsertPending,
  type PendingTrade,
} from "./trade-status-core.ts";

const NOW = 1_800_000_000_000;
const TX = `0x${"c".repeat(64)}` as const;

function trade(over: Partial<PendingTrade> = {}): PendingTrade {
  return {
    txHash: TX,
    chainId: 8453,
    wallet: "0x00000000000000000000000000000000000000AA",
    marketId: `0x${"1".repeat(64)}`,
    providerEventId: "401",
    direction: "buy",
    tokensRaw: "2000000",
    usdcRaw: "1000000",
    submittedAt: NOW,
    ...over,
  };
}

/**
 * Phase 7 / R-004 — pending, confirmed, failed and unknown are distinct;
 * a wallet rejection is not a failure; a reload keeps the trade.
 */
void describe("classifyTradeError", () => {
  void it("a wallet rejection is benign and says nothing was sent", () => {
    const e = classifyTradeError(new Error("User rejected the request."), "Trade failed");
    assert.equal(e.kind, "rejected");
    assert.match(e.message, /Nothing was sent/);
    const named = Object.assign(new Error("denied"), { name: "UserRejectedRequestError" });
    assert.equal(classifyTradeError(named, "x").kind, "rejected");
  });

  void it("an API error keeps the server's message; a network error explains the wallet sent nothing", () => {
    const api = Object.assign(new Error("Daily cap $100 would be exceeded"), { name: "ApiError" });
    assert.deepEqual(classifyTradeError(api, "x"), {
      kind: "server",
      message: "Daily cap $100 would be exceeded",
    });
    const net = classifyTradeError(new TypeError("Failed to fetch"), "x");
    assert.equal(net.kind, "offline");
    assert.equal(classifyTradeError(new Error("Network Error"), "x").kind, "offline");
    assert.match(net.message, /did not send anything/);
  });

  void it("anything else is unknown with the fallback when there is no message", () => {
    assert.deepEqual(classifyTradeError(42, "Trade failed"), {
      kind: "unknown",
      message: "Trade failed",
    });
  });
});

void describe("disposePending", () => {
  void it("confirmed → confirmed, flagging a fill the server does not yet have", () => {
    assert.deepEqual(disposePending(trade(), { state: "confirmed", recorded: false }, NOW), {
      kind: "confirmed",
      needsFillReport: true,
    });
    assert.deepEqual(disposePending(trade(), { state: "confirmed", recorded: true }, NOW), {
      kind: "confirmed",
      needsFillReport: false,
    });
  });

  void it("failed → failed; pending → keep, labeled slow after PENDING_SLOW_AFTER_MS", () => {
    assert.deepEqual(disposePending(trade(), { state: "failed", recorded: false }, NOW), {
      kind: "failed",
    });
    assert.deepEqual(disposePending(trade(), { state: "pending", recorded: false }, NOW + 1_000), {
      kind: "keep",
      slow: false,
    });
    assert.deepEqual(
      disposePending(
        trade(),
        { state: "pending", recorded: false },
        NOW + PENDING_SLOW_AFTER_MS + 1,
      ),
      {
        kind: "keep",
        slow: true,
      },
    );
  });

  void it("unknown is kept (propagation lag) until the give-up window, then dropped", () => {
    assert.deepEqual(disposePending(trade(), { state: "unknown", recorded: false }, NOW + 10_000), {
      kind: "keep",
      slow: false,
    });
    assert.deepEqual(
      disposePending(
        trade(),
        { state: "unknown", recorded: false },
        NOW + PENDING_UNKNOWN_GIVE_UP_MS + 1,
      ),
      {
        kind: "dropped",
      },
    );
  });
});

void describe("pending-trade persistence", () => {
  void it("round-trips through the storage string, lowercasing the wallet", () => {
    const stored = serializePendingTrades(upsertPending([], trade()));
    const back = parsePendingTrades(stored);
    assert.equal(back.length, 1);
    assert.equal(back[0]?.wallet, "0x00000000000000000000000000000000000000aa");
    assert.equal(back[0]?.txHash, TX);
  });

  void it("skips corrupt entries and tolerates garbage input without throwing", () => {
    assert.deepEqual(parsePendingTrades(null), []);
    assert.deepEqual(parsePendingTrades("{not json"), []);
    assert.deepEqual(parsePendingTrades('{"a":1}'), []);
    const mixed = JSON.stringify([trade(), { txHash: "0x12", chainId: 8453 }, 7, null]);
    assert.equal(parsePendingTrades(mixed).length, 1);
  });

  void it("upsert replaces by hash, remove drops by hash, and wallet filtering is case-insensitive and newest-first", () => {
    const older = trade({ submittedAt: NOW - 10 });
    const newer = trade({ txHash: `0x${"d".repeat(64)}`, submittedAt: NOW });
    let list = upsertPending([], older);
    list = upsertPending(list, newer);
    list = upsertPending(list, { ...older, usdcRaw: "5" });
    assert.equal(list.length, 2);
    assert.equal(list.find((t) => t.txHash === TX)?.usdcRaw, "5");
    const mine = pendingForWallet(list, "0x00000000000000000000000000000000000000aa");
    assert.deepEqual(
      mine.map((t) => t.txHash),
      [newer.txHash, TX],
    );
    assert.deepEqual(pendingForWallet(list, "0x00000000000000000000000000000000000000bb"), []);
    assert.equal(removePending(list, TX.toUpperCase()).length, 1);
  });
});
