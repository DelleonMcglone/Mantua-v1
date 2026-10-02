import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onlyDisplayed } from "./display-symbols.ts";

void describe("onlyDisplayed", () => {
  void it("keeps USDC and drops every other token, even with a balance", () => {
    const rows = [
      { symbol: "USDC", balanceRaw: "2500000" },
      { symbol: "EURC", balanceRaw: "5000000" },
      { symbol: "cirBTC", balanceRaw: "100" },
    ];
    assert.deepEqual(
      onlyDisplayed(rows).map((r) => r.symbol),
      ["USDC"],
    );
  });
  void it("shows a new account's zero rows as one USDC row", () => {
    const rows = [
      { symbol: "USDC", balanceRaw: "0" },
      { symbol: "EURC", balanceRaw: "0" },
      { symbol: "cirBTC", balanceRaw: "0" },
    ];
    assert.equal(onlyDisplayed(rows).length, 1);
  });
  void it("shows nothing for a feed with no USDC row", () => {
    assert.deepEqual(onlyDisplayed([{ symbol: "EURC", balanceRaw: "1" }]), []);
  });
});
