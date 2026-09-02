/**
 * Tests for shared input validation — the reject paths that guard every
 * action before a transaction is built.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { requireAddress, requirePositiveAmount } from "./validate.ts";

const VALID = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

test("requireAddress accepts a valid 0x address", () => {
  assert.equal(requireAddress(VALID), VALID);
});

test("requireAddress rejects malformed input with a labelled error", () => {
  assert.throws(() => requireAddress("0xnope", "provider"), /Invalid provider/);
  assert.throws(() => requireAddress("not-an-address"), /Invalid address/);
});

test("requirePositiveAmount accepts a positive decimal string", () => {
  assert.equal(requirePositiveAmount("1.5"), "1.5");
});

test("requirePositiveAmount rejects zero, negative, and non-numeric", () => {
  assert.throws(() => requirePositiveAmount("0", "amountUSDC"), /amountUSDC/);
  assert.throws(() => requirePositiveAmount("-1"), /positive/);
  assert.throws(() => requirePositiveAmount("abc"), /positive/);
});
