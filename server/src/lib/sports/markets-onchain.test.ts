import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { creatableMarkets } from "./markets-onchain.ts";
import { MARKETS_BY_CHAIN } from "../markets-contracts.ts";
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
    ...overrides,
  };
}

void describe("markets on-chain wiring", () => {
  // Base Mainnet markets deployment is pending — when an entry lands in
  // MARKETS_BY_CHAIN these assertions cover it automatically.
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
