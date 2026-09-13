import { strict as assert } from "node:assert";
import { test } from "node:test";
import { selectUsdcRaw, usdcRawToDollars } from "./live-balance-core.ts";

test("selectUsdcRaw picks the 6dp USDC row and nothing else (T-007)", () => {
  const rows = [
    { symbol: "EURC", balanceRaw: "5000000", decimals: 6 },
    { symbol: "USDC", balanceRaw: "12345678", decimals: 6 },
  ];
  assert.equal(selectUsdcRaw(rows), "12345678");
  assert.equal(selectUsdcRaw([]), null);
  assert.equal(selectUsdcRaw(null), null);
  assert.equal(selectUsdcRaw([{ symbol: "USDC", balanceRaw: "1e6", decimals: 6 }]), null);
  assert.equal(selectUsdcRaw([{ symbol: "USDC", balanceRaw: "1", decimals: 18 }]), null);
});

test("usdcRawToDollars formats the balance line", () => {
  assert.equal(usdcRawToDollars("12345678"), "$12.35");
  assert.equal(usdcRawToDollars("1000000000"), "$1,000.00");
  assert.equal(usdcRawToDollars(null), "—");
});
