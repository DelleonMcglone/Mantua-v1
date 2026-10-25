import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  binLine,
  isCalibrationPath,
  minutes,
  points,
  reliabilityDots,
  score,
} from "./calibration-core.ts";

void describe("calibration-core", () => {
  void it("answers /calibration with or without a trailing slash, nothing else", () => {
    assert.equal(isCalibrationPath("/calibration"), true);
    assert.equal(isCalibrationPath("/calibration/"), true);
    assert.equal(isCalibrationPath("/"), false);
    assert.equal(isCalibrationPath("/calibrations"), false);
  });

  void it("formats scores, points, band lines and durations with an honest dash for nothing", () => {
    assert.equal(score(0.25), "0.250");
    assert.equal(score(null), "—");
    assert.equal(points(5500), "55.0%");
    assert.equal(
      binLine({ fromBps: 7000, count: 20, meanPredictedBps: 7400, hitRateBps: 5500 }),
      "says 70–80%, right 55.0% (20)",
    );
    assert.equal(minutes(null), "—");
    assert.equal(minutes(30_000), "30s");
    assert.equal(minutes(90_000), "1.5 min");
  });

  void it("places one dot per band with data on the reliability square, sized by count", () => {
    const dots = reliabilityDots(
      [
        { fromBps: 0, count: 0, meanPredictedBps: null, hitRateBps: null },
        { fromBps: 7000, count: 4, meanPredictedBps: 7500, hitRateBps: 5000 },
        { fromBps: 9000, count: 1, meanPredictedBps: 9000, hitRateBps: 10_000 },
      ],
      200,
    );
    assert.equal(dots.length, 2);
    assert.deepEqual({ x: dots[0]?.x, y: dots[0]?.y }, { x: 150, y: 100 });
    assert.deepEqual({ x: dots[1]?.x, y: dots[1]?.y }, { x: 180, y: 0 });
    assert.ok((dots[0]?.r ?? 0) > (dots[1]?.r ?? 0));
  });
});
