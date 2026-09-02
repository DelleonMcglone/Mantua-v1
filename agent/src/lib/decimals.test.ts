/**
 * Tests for the USDC 6-decimal helpers — conversions are correct in both
 * directions and round-trip.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { USDC_DECIMALS, fromUsdcUnits, toUsdcUnits } from "./decimals.ts";

test("USDC uses the 6-decimal ERC-20 representation", () => {
  assert.equal(USDC_DECIMALS, 6);
});

test("USDC human ↔ base units", () => {
  assert.equal(toUsdcUnits("1"), 1_000_000n);
  assert.equal(toUsdcUnits("1.5"), 1_500_000n);
  assert.equal(toUsdcUnits("0.000001"), 1n);
  assert.equal(fromUsdcUnits(1_000_000n), "1");
  assert.equal(fromUsdcUnits(1_500_000n), "1.5");
});

test("human ↔ units round-trips", () => {
  for (const human of ["1", "1.5", "0.000001", "123.456789"]) {
    assert.equal(fromUsdcUnits(toUsdcUnits(human)), human);
  }
});
