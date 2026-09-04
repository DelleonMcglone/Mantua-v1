import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { marketTradeSpendUsd } from "./market-trade-build.ts";

describe("marketTradeSpendUsd (C-019 market-trade cap leg)", () => {
  it("prices a buy at its exact USDC amount (no feed involved)", () => {
    assert.equal(marketTradeSpendUsd("buy", 1_000_000n), 1);
    assert.equal(marketTradeSpendUsd("buy", 12_345_678n), 12.345678);
  });

  it("returns null for a sell — exits return USDC and touch no cap", () => {
    assert.equal(marketTradeSpendUsd("sell", 5_000_000n), null);
  });
});
