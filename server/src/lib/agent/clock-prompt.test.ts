import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clockPrompt } from "./clock-prompt.ts";

void describe("clockPrompt (Goal 1)", () => {
  void it("states the moment in UTC and Eastern with the weekday, and the time and edge rules", () => {
    const p = clockPrompt(new Date("2026-10-29T23:05:00Z"));
    assert.match(
      p,
      /^Current time: 2026-10-29T23:05:00.000Z \(Thursday, October 29, 2026 at 19:05 EDT\)\./,
    );
    assert.match(p, /Thursday game's final injury report was Wednesday/);
    assert.match(p, /Never tell the user to watch for .* after the kickoff/);
    assert.match(p, /candidate discrepancy, not an edge/);
    assert.match(p, /100 bps = 1 point/);
  });
});
