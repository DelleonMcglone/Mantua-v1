import { strict as assert } from "node:assert";
import { test } from "node:test";
import { closePositionDetail, rawToHuman6 } from "./market-trade-core.ts";

test("rawToHuman6 renders exact 6dp amounts from raw balances", () => {
  assert.equal(rawToHuman6(0n), "0");
  assert.equal(rawToHuman6(1n), "0.000001");
  assert.equal(rawToHuman6(1_000_000n), "1");
  assert.equal(rawToHuman6(1_234_567n), "1.234567");
  assert.equal(rawToHuman6(12_500_000n), "12.5");
  assert.equal(rawToHuman6("987654321"), "987.654321");
});

test("rawToHuman6 never rounds up past the balance (float-division trap)", () => {
  // 19.799999 raw: Number(19799999)/1e6 → 19.799999000000002 is fine, but
  // e.g. 0.1-style binary artifacts can round the last digit up under
  // toFixed. The digit-built string is exact by construction.
  assert.equal(rawToHuman6(19_799_999n), "19.799999");
  // Round-trip: parsing the string back at 6dp returns the exact raw value.
  for (const raw of [1n, 999_999n, 19_799_999n, 123_456_789_012n]) {
    const human = rawToHuman6(raw);
    assert.equal(BigInt(Math.round(Number(human) * 1e6)), raw);
  }
});

test("rawToHuman6 rejects negatives", () => {
  assert.throws(() => rawToHuman6(-1n));
});

test("closePositionDetail builds the deep-link for open YES rows only", () => {
  const open = {
    side: "yes",
    state: "OPEN",
    league: "nfl",
    providerEventId: "401547401",
    balance: "1234567",
  };
  assert.deepEqual(closePositionDetail(open), {
    league: "nfl",
    eventId: "401547401",
    balance: "1234567",
  });
  assert.equal(closePositionDetail({ ...open, side: "no" }), null);
  assert.equal(closePositionDetail({ ...open, state: "RESOLVED" }), null);
  assert.equal(closePositionDetail({ ...open, league: null }), null);
  assert.equal(closePositionDetail({ ...open, providerEventId: null }), null);
});
