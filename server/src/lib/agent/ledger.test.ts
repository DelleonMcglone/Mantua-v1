import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, ledgerDigest, type LedgerFill, type SimulationRow } from "./ledger.ts";

/**
 * Task 070 / AE-011, AE-013, AE-014 — the canonical ledger: every fill an
 * entry, every entry a mode, simulations in their own block, a digest over
 * the lot so nothing can be dropped unnoticed.
 */

const t = (h: number): Date => new Date(Date.UTC(2026, 8, 12, h));
const fill = (
  txHash: string,
  marketId: string,
  direction: "buy" | "sell",
  tokens: number,
  usdc: number,
  h: number,
): LedgerFill => ({
  txHash,
  marketId,
  direction,
  tokensRaw: String(Math.round(tokens * 1e6)),
  usdcRaw: String(Math.round(usdc * 1e6)),
  createdAt: t(h),
});

const FILLS: LedgerFill[] = [
  fill("0xa1", "0xwin", "buy", 16, 10, 1),
  fill("0xa2", "0xloss", "buy", 8, 5, 2),
  fill("0xa3", "0xloss", "sell", 2, 1.5, 3),
  fill("0xa4", "0xopen", "buy", 10, 6, 5),
];
const MARKETS = [
  { marketId: "0xwin", outcomeIndex: 0, state: "RESOLVED", resolvedAt: t(10) },
  { marketId: "0xloss", outcomeIndex: 1, state: "RESOLVED", resolvedAt: t(11) },
  { marketId: "0xopen", outcomeIndex: 0, state: "OPEN", resolvedAt: null },
];
const RESOLUTIONS = [
  { marketId: "0xwin", winningOutcomeIndex: 0, method: "auto" },
  { marketId: "0xloss", winningOutcomeIndex: 0, method: "auto" },
];
const AUDIT = new Map([
  ["0xa1", { action: "agent_market_trade", params: { args: { confirmationId: "c1" } } }],
  ["0xa2", { action: "agent_market_trade", params: { mode: "autonomous", args: {} } }],
  ["0xa3", { action: "strategy_close", params: {} }],
]);
const SIMS: SimulationRow[] = [
  { id: "s1", marketId: "0xopen", valueUsd: 4, executable: true, createdAt: t(4) },
  { id: "s2", marketId: null, valueUsd: null, executable: false, createdAt: t(6) },
];

void describe("buildLedger", () => {
  const ledger = buildLedger("0xAgent", FILLS, MARKETS, RESOLUTIONS, AUDIT, SIMS);

  void it("lists every fill as a trade with its mode and effective price, newest first", () => {
    assert.equal(ledger.trades.length, 4);
    assert.deepEqual(
      ledger.trades.map((x) => [x.txHash, x.mode]),
      [
        ["0xa4", "unattributed"],
        ["0xa3", "autonomous"],
        ["0xa2", "autonomous"],
        ["0xa1", "user_confirmed"],
      ],
    );
    const a1 = ledger.trades.find((x) => x.txHash === "0xa1");
    assert.ok(a1);
    assert.equal(a1.priceBps, 6250); // 10 USDC for 16 YES
    assert.equal(a1.usdc, 10);
    assert.equal(a1.tokens, 16);
  });

  void it("keeps the losing market in the record and labels each market's modes", () => {
    const loss = ledger.markets.find((m) => m.marketId === "0xloss");
    assert.ok(loss, "the loss is present");
    assert.equal(loss.status, "resolved_loss");
    assert.deepEqual(loss.modes, ["autonomous"]);
    assert.equal(loss.resolvedAt, t(11).toISOString());
    const open = ledger.markets.find((m) => m.marketId === "0xopen");
    assert.deepEqual(open?.modes, ["unattributed"]);
  });

  void it("breaks totals down by mode and never blends simulations into P&L", () => {
    assert.equal(ledger.byMode.user_confirmed.trades, 1);
    assert.equal(ledger.byMode.user_confirmed.stakedUsd, 10);
    assert.equal(ledger.byMode.user_confirmed.realizedPnlUsd, 6);
    assert.equal(ledger.byMode.autonomous.trades, 2);
    assert.equal(ledger.byMode.autonomous.realizedPnlUsd, -3.5);
    assert.equal(ledger.byMode.unattributed.trades, 1);
    assert.equal(ledger.byMode.simulated.trades, 0);
    assert.equal(ledger.mixedMarkets, 0);
    assert.equal(ledger.totals.realizedPnlUsd, 2.5);
    assert.deepEqual(ledger.simulated, {
      count: 2,
      executable: 1,
      notionalUsd: 4,
      latestAt: t(6).toISOString(),
    });
  });

  void it("counts a market whose fills span two modes as mixed, attributing its P&L to neither", () => {
    const audit = new Map(AUDIT);
    audit.set("0xa3", { action: "agent_market_trade", params: { args: { confirmationId: "c9" } } });
    const mixed = buildLedger("0xAgent", FILLS, MARKETS, RESOLUTIONS, audit, []);
    assert.equal(mixed.mixedMarkets, 1);
    assert.equal(mixed.byMode.autonomous.realizedPnlUsd, 0);
    assert.equal(mixed.byMode.user_confirmed.realizedPnlUsd, 6);
    assert.equal(mixed.totals.realizedPnlUsd, 2.5);
  });

  void it("changes the digest when any entry is removed", () => {
    const full = ledgerDigest(FILLS, SIMS);
    const short = ledgerDigest(
      FILLS.filter((f) => f.txHash !== "0xa2"),
      SIMS,
    );
    const noSim = ledgerDigest(FILLS, SIMS.slice(1));
    assert.notEqual(full, short);
    assert.notEqual(full, noSim);
    assert.equal(full, ledgerDigest([...FILLS].reverse(), [...SIMS].reverse()), "order-free");
    assert.match(full, /^[0-9a-f]{64}$/);
    assert.equal(ledger.digest, full);
  });
});
