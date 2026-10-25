import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rec } from "../lib/forecast/fixture.ts";
import { buildCalibrationReport } from "./calibration.ts";

void describe("buildCalibrationReport", () => {
  void it("totals count records, unique views, scoreable, pending, voided and after-kickoff", () => {
    const r = buildCalibrationReport(
      [
        rec({ id: "a" }),
        rec({ id: "b", outcome: null }),
        rec({ id: "c", outcome: null, voided: true }),
        rec({ id: "d", afterKickoff: true }),
        rec({ id: "e", action: "proposed" }),
        rec({ id: "e-fill", providerEventId: "e", action: "filled" }),
      ],
      123,
    );
    assert.equal(r.generatedAt, 123);
    assert.deepEqual(r.totals, {
      records: 6,
      views: 5,
      scoreable: 3,
      pending: 1,
      voided: 1,
      afterKickoff: 1,
    });
    assert.equal(r.all.n, 2, "a and e — b, c are unsettled and d is after kickoff");
    assert.equal(r.tradesOnly.n, 1);
    assert.equal(r.hitl.proposals, 1);
    assert.equal(r.hitl.approved, 1);
  });
});
