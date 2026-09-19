import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hapticTick, pressEnds } from "./press-events.ts";

void describe("mobile press semantics (MX-005)", () => {
  void it("a captured press survives the finger sliding off; everything else ends it", () => {
    assert.equal(pressEnds("pointerleave", true), false);
    assert.equal(pressEnds("pointerleave", false), true);
    for (const reason of ["pointerup", "pointercancel", "hidden", "blur"] as const) {
      assert.equal(pressEnds(reason, true), true, reason);
      assert.equal(pressEnds(reason, false), true, reason);
    }
  });

  void it("the haptic tick is optional and never throws", () => {
    const calls: (number | number[])[] = [];
    hapticTick({
      vibrate: (p) => {
        calls.push(p);
        return true;
      },
    });
    assert.deepEqual(calls, [8]);
    hapticTick({});
    hapticTick({
      vibrate: () => {
        throw new Error("not allowed");
      },
    });
  });
});
