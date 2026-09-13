import { strict as assert } from "node:assert";
import { test } from "node:test";
import { LANE_GAP_PX, annotationSummary, placeAnnotations } from "./chart-annotations.ts";
import type { ChartAnnotation } from "./depth-types.ts";

const A: ChartAnnotation[] = [
  { t: 100, kind: "kickoff", label: "Kickoff" },
  { t: 110, kind: "period", label: "Q2" },
  { t: 400, kind: "period", label: "2nd half" },
  { t: 900, kind: "frozen", label: "Trading closed" },
  { t: 50, kind: "injury", label: "KC: Chris Jones questionable" },
  { t: 2000, kind: "resolved", label: "Resolved" },
];

test("only annotations inside the window are placed, in time order, scaled to width", () => {
  const placed = placeAnnotations(A, 100, 1000, 900);
  assert.deepEqual(
    placed.map((p) => p.label),
    ["Kickoff", "Q2", "2nd half", "Trading closed"],
  );
  assert.equal(placed[0]?.x, 0);
  assert.equal(placed[2]?.x, 300);
  assert.equal(placed[3]?.x, 800);
});

test("labels that would collide alternate lanes; spaced ones stay on top", () => {
  const placed = placeAnnotations(A, 100, 1000, 900);
  assert.equal(placed[0]?.lane, 0);
  assert.equal(placed[1]?.lane, 1, "Q2 is 10px from Kickoff");
  assert.equal(placed[2]?.lane, 0);
  assert.ok((placed[2]?.x ?? 0) - (placed[1]?.x ?? 0) > LANE_GAP_PX);
});

test("the summary counts what is marked and is null when nothing is", () => {
  assert.equal(
    annotationSummary(placeAnnotations(A, 0, 3000, 900)),
    "Marked: kickoff, 2 period changes, 1 injury report, close, resolution",
  );
  assert.equal(annotationSummary([]), null);
});
