import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sizePosition } from "./position-sizing.ts";

void describe("sizePosition", () => {
  void it("sizes $100 at 40¢: 250 contracts, lose at most 100, win up to 150", () => {
    const s = sizePosition(100, 4000);
    assert.equal(s.contracts, 250);
    assert.equal(s.maxLossUsdc, 100);
    assert.equal(s.maxProfitUsdc, 150);
    assert.equal(s.breakevenWinProbabilityBps, 4000);
    assert.equal(s.takeProfitBps, 7000);
  });
  void it("prices the ±5/10/20% scenarios against the entry", () => {
    const s = sizePosition(100, 4000);
    assert.deepEqual(
      s.scenarios.map((x) => [x.move, x.priceBps, x.pnlUsdc]),
      [
        ["-20%", 3200, -20],
        ["-10%", 3600, -10],
        ["-5%", 3800, -5],
        ["+5%", 4200, 5],
        ["+10%", 4400, 10],
        ["+20%", 4800, 20],
      ],
    );
  });
  void it("never prices a scenario outside the 0–1 contract range", () => {
    const s = sizePosition(50, 9_500);
    assert.ok(s.scenarios.every((x) => x.priceBps >= 1 && x.priceBps <= 9_999));
  });
  void it("rejects a non-positive risk", () => {
    assert.throws(() => sizePosition(0, 5000), /positive/);
  });
});
