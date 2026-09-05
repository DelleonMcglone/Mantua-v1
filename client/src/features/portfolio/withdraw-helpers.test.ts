import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  clampToBalance,
  formatRawAmount,
  isValidEvmAddress,
  parseAmountRaw,
} from "./withdraw-helpers.ts";

test("isValidEvmAddress: accepts a canonical 0x + 40 hex address", () => {
  assert.equal(isValidEvmAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), true);
  assert.equal(isValidEvmAddress("0x" + "a".repeat(40)), true);
});

test("isValidEvmAddress: rejects malformed input", () => {
  assert.equal(isValidEvmAddress(""), false);
  assert.equal(isValidEvmAddress("0x123"), false); // too short
  assert.equal(isValidEvmAddress("0x" + "a".repeat(41)), false); // too long
  assert.equal(isValidEvmAddress("0x" + "g".repeat(40)), false); // non-hex
  assert.equal(isValidEvmAddress("833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), false); // no 0x
  assert.equal(isValidEvmAddress(" 0x" + "a".repeat(40)), false); // leading space
});

test("parseAmountRaw: plain decimals to raw base units", () => {
  assert.equal(parseAmountRaw("1.5", 6), 1_500_000n);
  assert.equal(parseAmountRaw("0.000001", 6), 1n);
  assert.equal(parseAmountRaw("25", 6), 25_000_000n);
  assert.equal(parseAmountRaw("1.", 6), 1_000_000n); // trailing dot ok
  assert.equal(parseAmountRaw(" 2 ", 6), 2_000_000n); // surrounding whitespace trimmed
  assert.equal(parseAmountRaw("0.00000001", 8), 1n); // cbBTC-style 8dp
});

test("parseAmountRaw: rejects non-amounts and zero", () => {
  assert.equal(parseAmountRaw("", 6), null);
  assert.equal(parseAmountRaw("0", 6), null);
  assert.equal(parseAmountRaw("0.0", 6), null);
  assert.equal(parseAmountRaw("-1", 6), null);
  assert.equal(parseAmountRaw("1e6", 6), null);
  assert.equal(parseAmountRaw("1,5", 6), null);
  assert.equal(parseAmountRaw(".5", 6), null); // require a leading digit
  assert.equal(parseAmountRaw("abc", 6), null);
  assert.equal(parseAmountRaw("0x10", 6), null);
});

test("parseAmountRaw: rejects more fraction digits than the token carries", () => {
  assert.equal(parseAmountRaw("1.0000001", 6), null);
  assert.equal(parseAmountRaw("1.000001", 6), 1_000_001n);
});

test("clampToBalance: max-button semantics", () => {
  assert.equal(clampToBalance(5n, 10n), 5n);
  assert.equal(clampToBalance(15n, 10n), 10n);
  assert.equal(clampToBalance(10n, 10n), 10n);
  assert.equal(clampToBalance(-1n, 10n), 0n);
});

test("formatRawAmount: full precision, no trailing zeros", () => {
  assert.equal(formatRawAmount(1_500_000n, 6), "1.5");
  assert.equal(formatRawAmount(25_000_000n, 6), "25");
  assert.equal(formatRawAmount(1n, 6), "0.000001");
  assert.equal(formatRawAmount(1_000_001n, 6), "1.000001");
  assert.equal(formatRawAmount(0n, 6), "0");
  assert.equal(formatRawAmount(123n, 0), "123");
});

test("formatRawAmount round-trips through parseAmountRaw", () => {
  for (const raw of [1n, 999n, 1_500_000n, 123_456_789n]) {
    assert.equal(parseAmountRaw(formatRawAmount(raw, 6), 6), raw);
  }
});
