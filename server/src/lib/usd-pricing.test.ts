import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PriceUnavailableError, requirePositivePrice } from "./usd-pricing.ts";

describe("requirePositivePrice (C-019 fail-closed pricing core)", () => {
  it("blocks the trade when the feed returns 0 — no price, no trade", () => {
    assert.throws(() => requirePositivePrice(0, "USDC"), PriceUnavailableError);
  });

  it("blocks negative garbage the same way", () => {
    assert.throws(() => requirePositivePrice(-1, "USDC"), PriceUnavailableError);
  });

  it("passes a live price through unchanged", () => {
    assert.equal(requirePositivePrice(1.02, "USDC"), 1.02);
  });

  it("names the unpriced token so operators can see what was blocked", () => {
    try {
      requirePositivePrice(0, "EURC");
      assert.fail("expected PriceUnavailableError");
    } catch (err) {
      assert.ok(err instanceof PriceUnavailableError);
      assert.equal(err.symbol, "EURC");
      assert.match(err.message, /EURC/);
    }
  });
});
