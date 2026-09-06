import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Task 041 — the board's `?dates=` validation and its mapping onto the
 * canonical read's [fromMs, toMs] window. Pure functions; the route body is
 * the canonical read + withLiveOdds, both covered by their own suites.
 */
import { datesToRangeMs, parseDates } from "./sports-slate.ts";

void describe("parseDates (board range validation)", () => {
  void it("accepts a well-formed bounded range and rejects malformed input", () => {
    assert.equal(parseDates("20260901-20260907"), "20260901-20260907");
    assert.equal(parseDates(undefined), null);
    for (const bad of ["2026", "20260907-20260901", 42, "20260101-20270101"]) {
      const out = parseDates(bad);
      assert.equal(typeof out === "object" && out !== null && "error" in out, true, String(bad));
    }
  });
});

void describe("datesToRangeMs (041 canonical window)", () => {
  void it("maps the range onto an inclusive-end UTC window", () => {
    const range = datesToRangeMs("20260901-20260907");
    assert.ok(range);
    assert.equal(range.fromMs, Date.parse("2026-09-01T00:00:00Z"));
    // End day inclusive: the window closes at the START of the next day.
    assert.equal(range.toMs, Date.parse("2026-09-08T00:00:00Z"));
  });

  void it("covers a single day when start and end match", () => {
    const range = datesToRangeMs("20260906-20260906");
    assert.ok(range);
    assert.equal(range.toMs - range.fromMs, 86_400_000);
  });
});
