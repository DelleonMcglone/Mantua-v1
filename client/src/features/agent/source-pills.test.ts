import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { costLabel, isSourceTool, pillFor } from "./source-pills.ts";

void describe("source pills", () => {
  void it("labels Mantua's own reads by category and marks them free", () => {
    assert.deepEqual(pillFor("get_player_injury_status", undefined), {
      provider: "Mantua",
      category: "injuries",
    });
    assert.equal(costLabel("get_player_injury_status", undefined), "free");
  });
  void it("labels a paid call by its provider and shows what it cost", () => {
    const data = { provider: "Exa", service: "https://api.exa.ai/search", usdCost: 0.01 };
    assert.deepEqual(pillFor("call_paid_service", data), {
      provider: "Exa",
      category: "paid data",
    });
    assert.equal(costLabel("call_paid_service", data), "0.01 USDC");
    assert.equal(costLabel("call_paid_service", { ...data, usdCost: 0 }), "free");
  });
  void it("says so when the marketplace is unavailable", () => {
    assert.equal(costLabel("call_paid_service", { available: false }), "unavailable");
  });
  void it("leaves money-moving and wallet tools as ordinary steps", () => {
    assert.equal(isSourceTool("mantua_execute_trade"), false);
    assert.equal(isSourceTool("manage_wallet"), false);
    assert.equal(pillFor("send", undefined), null);
  });
});
