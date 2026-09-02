/**
 * Tests for the asset allowlist — accept path (USDC/EURC/cbBTC by symbol
 * and address) and reject path (anything else throws a clear error).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Asset, createAssetAllowlist } from "./assets.ts";

const FIXTURE: Asset[] = [
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { symbol: "EURC", address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", decimals: 6 },
  { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
];

test("resolves allowlisted assets by symbol (case-insensitive)", () => {
  const a = createAssetAllowlist(FIXTURE);
  assert.equal(a.requireAllowed("USDC").decimals, 6);
  assert.equal(a.requireAllowed("eurc").symbol, "EURC");
  assert.equal(a.requireAllowed("cbBTC").decimals, 8);
});

test("resolves allowlisted assets by address (normalized lowercase)", () => {
  const a = createAssetAllowlist(FIXTURE);
  const usdc = a.requireAllowed("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  assert.equal(usdc.symbol, "USDC");
  assert.ok(a.isAllowedAddress("0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42"));
});

test("rejects a non-allowlisted symbol with a clear error", () => {
  const a = createAssetAllowlist(FIXTURE);
  assert.throws(() => a.requireAllowed("DAI"), /not on the allowlist/);
  assert.throws(() => a.requireAllowed("WETH"), /USDC, EURC, cbBTC/);
});

test("rejects a non-allowlisted address", () => {
  const a = createAssetAllowlist(FIXTURE);
  assert.equal(a.isAllowedAddress("0x000000000000000000000000000000000000dEaD"), false);
  assert.throws(() => a.requireAllowed("0x000000000000000000000000000000000000dEaD"), /allowlist/);
});

test("fails fast on a malformed config address", () => {
  assert.throws(
    () => createAssetAllowlist([{ symbol: "USDC", address: "0xnope", decimals: 6 }]),
    /Invalid address/,
  );
});
