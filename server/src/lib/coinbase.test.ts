/**
 * Tests for the Coinbase market-data lib — the input-validation reject
 * path (product-id format) that guards every request before any fetch.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCoinbaseMarket, getCoinbaseSpot } from "./coinbase.ts";

describe("coinbase product-id validation", () => {
  it("rejects malformed product ids before fetching", async () => {
    await assert.rejects(() => getCoinbaseSpot("not a pair"), /Invalid Coinbase product id/);
    await assert.rejects(() => getCoinbaseSpot("btc/usd"), /Invalid Coinbase product id/);
    await assert.rejects(() => getCoinbaseMarket("'; DROP"), /Invalid Coinbase product id/);
  });
});
