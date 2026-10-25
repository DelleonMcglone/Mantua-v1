import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rec } from "./fixture.ts";
import { CSV_COLUMNS, forecastsCsv } from "./calibration-read.ts";

void describe("forecastsCsv", () => {
  void it("one header, one line per record oldest first, nulls empty, quotes escaped", () => {
    const csv = forecastsCsv([
      rec({ id: "b", createdAt: new Date("2026-10-24T18:00:00Z"), outcome: null }),
      rec({ id: "a", createdAt: new Date("2026-10-24T17:00:00Z"), sessionId: 's,"q"' }),
    ]);
    const lines = csv.trimEnd().split("\n");
    assert.equal(lines[0], CSV_COLUMNS.join(","));
    assert.equal(lines.length, 3);
    assert.ok(lines[1]?.startsWith("a,2026-10-24T17:00:00.000Z,"));
    assert.ok(lines[1]?.includes('"s,""q"""'));
    assert.ok(lines[2]?.startsWith("b,2026-10-24T18:00:00.000Z,"));
    const cells = lines[2]?.split(",") ?? [];
    assert.equal(cells.at(-2), "", "an open record's outcome is empty");
  });
});
