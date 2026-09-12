import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PREDICTION_NOTE, formatProbability, probabilitySource } from "./probability-source.ts";

test("a live pool price is labelled as the market's own (T-021)", () => {
  const src = probabilitySource({ liveOdds: true });
  assert.equal(src.kind, "market");
  assert.match(src.label, /market/i);
  assert.doesNotMatch(src.label, /model|agent/i);
});

test("a provider line is labelled as a projection, never as the market", () => {
  const src = probabilitySource({ liveOdds: false });
  assert.equal(src.kind, "projection");
  assert.match(src.label, /projection/i);
  assert.equal(probabilitySource({}).kind, "projection");
});

test("an agent estimate is labelled as such and never as certainty (T-022)", () => {
  const src = probabilitySource({ model: true });
  assert.equal(src.kind, "model");
  assert.match(src.label, /estimate/i);
  assert.match(PREDICTION_NOTE, /not a guarantee/i);
  assert.doesNotMatch(PREDICTION_NOTE, /\b(will win|certain|guaranteed)\b/i);
});

test("formatProbability renders bps as a whole percent and a cents price", () => {
  assert.equal(formatProbability(6250).percent, "63%");
  assert.equal(formatProbability(6250).cents, "63¢");
  assert.equal(formatProbability(6250, 1).percent, "38%", "the away side is the complement");
  assert.equal(formatProbability(50).cents, "1¢", "clamped into 1–99¢");
  assert.equal(formatProbability(9990).cents, "99¢");
  assert.equal(formatProbability(undefined).percent, "—");
});
