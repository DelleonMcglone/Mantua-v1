import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  indexMarketPools,
  marketStatusLabel,
  marketStatusTone,
  showMarketStatusColumn,
  type MarketPoolInfo,
} from "./market-pools.ts";

function pool(overrides: Partial<MarketPoolInfo> = {}): MarketPoolInfo {
  return {
    marketId: "0x" + "11".repeat(32),
    poolId: "0xABCDEF" + "00".repeat(29),
    state: "OPEN",
    outcomeIndex: 0,
    chainId: 8453,
    providerEventId: "401671789",
    label: "Chiefs",
    event: "Raiders @ Chiefs",
    startsAt: 1_900_000_000,
    league: "nfl",
    sport: "football",
    ...overrides,
  };
}

describe("marketStatusLabel", () => {
  it("maps lifecycle states to display labels", () => {
    assert.equal(marketStatusLabel("OPEN"), "Open");
    assert.equal(marketStatusLabel("FROZEN"), "Frozen");
    assert.equal(marketStatusLabel("RESOLVED"), "Resolved");
    assert.equal(marketStatusLabel("SETTLED"), "Settled");
    assert.equal(marketStatusLabel("INVALID"), "Void");
  });

  it("passes unknown states through instead of lying", () => {
    assert.equal(marketStatusLabel("WEIRD"), "WEIRD");
  });
});

describe("marketStatusTone", () => {
  it("OPEN is live, FROZEN is paused, terminal states are done", () => {
    assert.equal(marketStatusTone("OPEN"), "live");
    assert.equal(marketStatusTone("FROZEN"), "paused");
    assert.equal(marketStatusTone("RESOLVED"), "done");
    assert.equal(marketStatusTone("SETTLED"), "done");
    assert.equal(marketStatusTone("INVALID"), "done");
  });
});

describe("indexMarketPools", () => {
  it("keys by lowercased poolId so on-chain casing differences still join", () => {
    const p = pool();
    const idx = indexMarketPools([p]);
    assert.equal(idx.get(p.poolId.toLowerCase()), p);
    assert.equal(idx.size, 1);
  });
});

describe("showMarketStatusColumn (B7-006 edge case)", () => {
  it("is false with no markets — the column must be absent, not empty", () => {
    assert.equal(showMarketStatusColumn([]), false);
    assert.equal(showMarketStatusColumn(null), false);
    assert.equal(showMarketStatusColumn(undefined), false);
  });

  it("is true once at least one market pool exists", () => {
    assert.equal(showMarketStatusColumn([pool()]), true);
  });
});
