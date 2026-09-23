import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  creatableMarkets,
  marketSignerWallet,
  planPositionSettlement,
  type SettleablePositionRow,
} from "./markets-onchain.ts";
import { MARKETS_BY_CHAIN } from "../markets-contracts.ts";
import { BASE_CHAIN_ID } from "../chains.ts";
import { env } from "../../env.ts";
import { isAllowedTarget } from "../circle/allowed-targets.ts";
import type { PlannedMarket } from "./ingest.ts";

const NOW = 1_800_000_000;

function planned(overrides: Partial<PlannedMarket> = {}): PlannedMarket {
  return {
    marketId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    providerEventId: "401671789",
    league: "nfl",
    marketType: "moneyline",
    outcomeIndex: 0,
    label: "KC to beat LV",
    kickoffTimestamp: NOW + 3600,
    openingProbability: 0.62,
    playoffs: false,
    ...overrides,
  };
}

void describe("markets on-chain wiring", () => {
  void it("registers the Base settlement layer deployed 2026-09-23", () => {
    assert.deepEqual(MARKETS_BY_CHAIN[BASE_CHAIN_ID], {
      factory: "0x52e8c370Ff772408b925f8524f49BFd1B96Beb93",
      resolver: "0x448E16702C19fF0b0AF7b51D675Cc40f1b2D5281",
      collateral: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
  });

  void it("opens nothing without the operator's signing key — the deployed-but-closed state", (t) => {
    // Markets are deployed but held closed until launch sign-off by leaving
    // MARKET_SIGNER_PRIVATE_KEY unset in production: no signer, no
    // createMarketIfAbsent / registerPool / seed transactions.
    if (env.MARKET_SIGNER_PRIVATE_KEY !== undefined) {
      t.skip("MARKET_SIGNER_PRIVATE_KEY is set in this environment");
      return;
    }
    assert.equal(marketSignerWallet(BASE_CHAIN_ID), null);
  });

  // Every configured settlement layer, Base's included.
  void it("configured settlement layers are checksummed, distinct, and allowlisted (B8-006)", () => {
    for (const markets of Object.values(MARKETS_BY_CHAIN)) {
      // Object.values on an interface type falls back to any[]; the cast
      // restores the address typing for the assertions below.
      for (const addr of Object.values(markets) as `0x${string}`[]) {
        assert.equal(getAddress(addr), addr, addr);
      }
      assert.equal(new Set(Object.values(markets)).size, 3);
      assert.ok(isAllowedTarget(markets.factory));
      assert.ok(isAllowedTarget(markets.resolver));
      assert.ok(isAllowedTarget(markets.collateral));
    }
  });

  void it("creatableMarkets drops games at or past kickoff — the factory would revert StartInPast", () => {
    const list = [
      planned(),
      planned({ marketId: "0x22…", kickoffTimestamp: NOW }),
      planned({ marketId: "0x33…", kickoffTimestamp: NOW - 60 }),
    ] as PlannedMarket[];
    const out = creatableMarkets(list, NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].kickoffTimestamp, NOW + 3600);
  });
});

describe("planPositionSettlement (P-006 — the pure half of the settlement pass)", () => {
  const MARKET_A = "0x" + "aa".repeat(32);
  const MARKET_B = "0x" + "bb".repeat(32);
  const AGENT = "0xagent0000000000000000000000000000000001";
  const USER = "0xuser00000000000000000000000000000000002";

  function row(overrides: Partial<SettleablePositionRow> = {}): SettleablePositionRow {
    return {
      id: "p1",
      marketId: MARKET_A,
      walletAddress: USER,
      side: "yes",
      state: "RESOLVED",
      redeemedAt: null,
      ...overrides,
    };
  }

  it("marks winners at $1 and losers at $0, per the resolutions log's winner", () => {
    const plan = planPositionSettlement(
      [row({ id: "w", side: "yes" }), row({ id: "l", side: "no" })],
      new Map([[MARKET_A, 0]]),
    );
    assert.deepEqual(
      plan.marks.map((m) => `${m.id}:${m.settlementPrice}`),
      ["w:1.00000", "l:0.00000"],
    );
  });

  it("marks both sides at $0.50 on INVALID with no winner needed", () => {
    const plan = planPositionSettlement(
      [row({ id: "y", state: "INVALID" }), row({ id: "n", side: "no", state: "INVALID" })],
      new Map(),
    );
    assert.deepEqual(
      plan.marks.map((m) => m.settlementPrice),
      ["0.50000", "0.50000"],
    );
  });

  it("HOLDS a resolved market whose winner the log doesn't know — never guesses", () => {
    const plan = planPositionSettlement([row()], new Map());
    assert.equal(plan.marks.length, 0);
    assert.equal(plan.heldUnknownWinner, 1);
  });

  it("only positions with claimable value and no redemption become redeem candidates, deduped per (market, wallet)", () => {
    const plan = planPositionSettlement(
      [
        row({ id: "a", walletAddress: AGENT, side: "yes" }), // wins → candidate
        row({ id: "b", walletAddress: AGENT, side: "yes", marketId: MARKET_B }), // wins → candidate
        row({ id: "c", walletAddress: USER, side: "no" }), // loses → no claim
        row({ id: "d", walletAddress: USER, side: "yes", redeemedAt: new Date() }), // already claimed
        row({ id: "e", walletAddress: AGENT, side: "yes" }), // duplicate pair of "a"
      ],
      new Map([
        [MARKET_A, 0],
        [MARKET_B, 0],
      ]),
    );
    assert.deepEqual(plan.redeemCandidates, [
      { marketId: MARKET_A, walletAddress: AGENT },
      { marketId: MARKET_B, walletAddress: AGENT },
    ]);
    // The already-redeemed winner still settles — the price is fact either way.
    assert.equal(plan.marks.length, 5);
  });
});
