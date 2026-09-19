import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COMBO_POLICY,
  comboPolicyFrom,
  comboPolicyGate,
  comboPolicySchema,
} from "./combo-policy.ts";

/** Task 072 / CB-010 — the user's combo limits and the one gate. */

const platform = { maxLegs: 6, maxStakeUsd: 500 };
const policy = { status: "active" as const, allowedLeagues: [], combo: DEFAULT_COMBO_POLICY };
const ctx = {
  legs: 3,
  stakeUsd: 20,
  payoutUsd: 150,
  openExposureUsd: 50,
  leagues: ["nfl", "nfl", "nfl"],
  platform,
};

void describe("comboPolicyGate", () => {
  void it("passes a ticket inside every limit", () => {
    assert.deepEqual(comboPolicyGate(policy, ctx), { ok: true, reasons: [] });
  });

  void it("names every limit it breaks at once", () => {
    const r = comboPolicyGate(
      { ...policy, status: "paused", combo: { ...DEFAULT_COMBO_POLICY, enabled: false } },
      { ...ctx, legs: 4, stakeUsd: 30, payoutUsd: 5_000, openExposureUsd: 90 },
    );
    assert.equal(r.ok, false);
    assert.equal(r.reasons.length, 6);
    assert.match(r.reasons[2] ?? "", /4 legs — the limit is 3/);
    assert.match(r.reasons[3] ?? "", /\$30\.00 is above the \$25\.00/);
    assert.match(r.reasons[4] ?? "", /\$120\.00, above the \$100\.00/);
  });

  void it("takes the tighter of the user's and the platform's leg and stake limits", () => {
    const r = comboPolicyGate(
      { ...policy, combo: { ...DEFAULT_COMBO_POLICY, maxLegs: 8, maxStakeUsd: 1_000 } },
      {
        ...ctx,
        legs: 7,
        stakeUsd: 600,
        openExposureUsd: 0,
        platform: { maxLegs: 6, maxStakeUsd: 500 },
      },
    );
    assert.deepEqual(
      r.reasons.map((s) => s.split(" ")[0]),
      ["7", "stake", "open"],
    );
    assert.match(r.reasons[0] ?? "", /limit is 6/);
    assert.match(r.reasons[1] ?? "", /\$500\.00 ticket limit/);
  });

  void it("enforces the allowed leagues once", () => {
    const r = comboPolicyGate(
      { ...policy, allowedLeagues: ["nfl"] },
      { ...ctx, leagues: ["wnba", null] },
    );
    assert.deepEqual(r.reasons, ["wnba is not in the allowed leagues"]);
  });
});

void describe("combo policy schema", () => {
  void it("is strict and bounded", () => {
    assert.equal(comboPolicySchema.safeParse({ ...DEFAULT_COMBO_POLICY, extra: 1 }).success, false);
    assert.equal(
      comboPolicySchema.safeParse({ ...DEFAULT_COMBO_POLICY, maxLegs: 9 }).success,
      false,
    );
    assert.equal(
      comboPolicySchema.safeParse({ ...DEFAULT_COMBO_POLICY, takeProfitBps: 100 }).success,
      false,
    );
    assert.equal(comboPolicySchema.safeParse(DEFAULT_COMBO_POLICY).success, true);
  });

  void it("fills defaults over a partial or malformed stored block", () => {
    assert.deepEqual(comboPolicyFrom(undefined), DEFAULT_COMBO_POLICY);
    assert.deepEqual(comboPolicyFrom({ maxLegs: 2 }), { ...DEFAULT_COMBO_POLICY, maxLegs: 2 });
    assert.deepEqual(comboPolicyFrom({ maxLegs: "x" }), DEFAULT_COMBO_POLICY);
  });
});
