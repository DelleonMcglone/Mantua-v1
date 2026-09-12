import { strict as assert } from "node:assert";
import { test } from "node:test";
import { priceMovement } from "./market-movement.ts";

const NOW = 1_800_000_000;
const H = 3600;

test("movement compares the latest price with the freshest point ≥24h old (T-010)", () => {
  const points = [
    { t: NOW - 30 * H, outcomeIndex: 0, priceBps: 5000 },
    { t: NOW - 25 * H, outcomeIndex: 0, priceBps: 5500 },
    { t: NOW - 2 * H, outcomeIndex: 0, priceBps: 5900 },
    { t: NOW - 2 * H, outcomeIndex: 1, priceBps: 4100 },
  ];
  const m = priceMovement(points, 0, NOW);
  assert.equal(m.deltaBps, 400);
  assert.equal(m.label, "▲ 4 pts today");
  assert.equal(
    priceMovement(points, 1, NOW).label,
    "No trades yet",
    "a lone point has no movement",
  );
});

test("a young series compares against its first point and says so", () => {
  const points = [
    { t: NOW - 3 * H, outcomeIndex: 0, priceBps: 6200 },
    { t: NOW - H, outcomeIndex: 0, priceBps: 6000 },
  ];
  assert.equal(priceMovement(points, 0, NOW).label, "▼ 2 pts recently");
});

test("no change and no data are both honest", () => {
  const flat = [
    { t: NOW - 30 * H, outcomeIndex: 0, priceBps: 6000 },
    { t: NOW - H, outcomeIndex: 0, priceBps: 6040 },
  ];
  assert.equal(priceMovement(flat, 0, NOW).label, "No change today");
  assert.equal(priceMovement([], 0, NOW).label, "No trades yet");
});
