import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { liveTickGate } from "./live-tick-gate.ts";

const T = Date.UTC(2026, 9, 21, 15, 17); // 15:17Z, a quiet Wednesday minute
const s = Math.floor(T / 1000);

void describe("liveTickGate", () => {
  void it("runs for a live game, a kickoff within two hours, or a game in the last five", () => {
    assert.equal(
      liveTickGate(T, [{ startsAt: s - 3600, status: "in_progress" }]).reason,
      "live_game",
    );
    assert.equal(
      liveTickGate(T, [{ startsAt: s + 90 * 60, status: "scheduled" }]).reason,
      "kickoff_near",
    );
    assert.equal(
      liveTickGate(T, [{ startsAt: s - 4 * 3600, status: "final" }]).reason,
      "post_game",
    );
  });

  void it("skips a quiet minute and keeps one tick an hour", () => {
    const quiet = [{ startsAt: s + 3 * 86400, status: "scheduled" }];
    assert.deepEqual(liveTickGate(T, quiet), { run: false, reason: "quiet" });
    assert.deepEqual(liveTickGate(Date.UTC(2026, 9, 21, 15, 2), quiet), {
      run: true,
      reason: "hourly",
    });
    assert.deepEqual(liveTickGate(T, []), { run: false, reason: "quiet" });
  });
});
