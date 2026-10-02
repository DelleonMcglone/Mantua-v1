import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onlyDisplayed } from "./display-symbols.ts";

void describe("onlyDisplayed (server)", () => {
  void it("gives the agent a USDC-only balance list, even for an empty wallet", () => {
    const rows = [
      { symbol: "USDC", balanceRaw: "0" },
      { symbol: "EURC", balanceRaw: "0" },
      { symbol: "cirBTC", balanceRaw: "0" },
    ];
    assert.deepEqual(
      onlyDisplayed(rows).map((r) => r.symbol),
      ["USDC"],
    );
  });
  void it("drops other tokens even when they hold a balance", () => {
    assert.deepEqual(onlyDisplayed([{ symbol: "EURC", balanceRaw: "5" }]), []);
  });
});
