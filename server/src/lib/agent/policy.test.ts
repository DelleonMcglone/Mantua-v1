import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentPolicy } from "../../db/schema/agent.ts";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const {
  DEFAULT_HEDGE_POLICY,
  DEFAULT_POLICY,
  hedgePolicyGate,
  policyPatchSchema,
  toUserPolicyRead,
  viewFromRow,
} = await import("./policy.ts");
const { HARD_DAILY_CAP_USD } = await import("../constants.ts");

/** Phase 8 / A-003, A-012, A-038 (D-109) — the policy's pure halves. */

function row(over: Partial<AgentPolicy>): AgentPolicy {
  return {
    id: "pol_1",
    userId: "usr_1",
    status: "active",
    autoTradeEnabled: false,
    maxStakePerTradeUsd: "25.00",
    riskLevel: "conservative",
    allowedLeagues: [],
    config: {},
    createdAt: new Date("2026-09-12T00:00:00Z"),
    updatedAt: new Date("2026-09-12T01:00:00Z"),
    ...over,
  };
}

void describe("viewFromRow", () => {
  void it("returns the defaults for a missing row and fills malformed fields", () => {
    assert.deepEqual(viewFromRow(null), DEFAULT_POLICY);
    const v = viewFromRow(
      row({
        status: "weird",
        maxStakePerTradeUsd: "not-a-number",
        riskLevel: "yolo",
        allowedLeagues: ["nfl", 42, "mlb"],
        config: { hedge: { maxSizeUsd: 10, cooldownMinutes: -5 } },
      }),
    );
    assert.equal(v.status, "active");
    assert.equal(v.maxStakePerTradeUsd, 25);
    assert.equal(v.riskLevel, "conservative");
    assert.deepEqual(v.allowedLeagues, ["nfl"]);
    // A partially invalid hedge block falls back to the defaults as a whole.
    assert.deepEqual(v.hedge, DEFAULT_HEDGE_POLICY);
    assert.equal(v.persisted, true);
  });

  void it("clamps a stored stake above the hard ceiling and reads a valid hedge block", () => {
    const v = viewFromRow(
      row({
        maxStakePerTradeUsd: "999999",
        config: { hedge: { maxSizeUsd: 10, dailyBudgetUsd: 40 } },
        status: "paused",
        autoTradeEnabled: true,
      }),
    );
    assert.equal(v.maxStakePerTradeUsd, HARD_DAILY_CAP_USD);
    assert.equal(v.hedge.maxSizeUsd, 10);
    assert.equal(v.hedge.dailyBudgetUsd, 40);
    assert.equal(v.hedge.maxExposureUsd, DEFAULT_HEDGE_POLICY.maxExposureUsd);
    assert.equal(v.status, "paused");
    assert.deepEqual(toUserPolicyRead(v), {
      status: "paused",
      maxStakePerTradeUsd: HARD_DAILY_CAP_USD,
      allowedLeagues: [],
      maxExposureUsd: 100,
    });
  });
});

void describe("policyPatchSchema", () => {
  void it("rejects an empty patch, unknown keys, over-ceiling and non-launch leagues", () => {
    assert.equal(policyPatchSchema.safeParse({}).success, false);
    assert.equal(policyPatchSchema.safeParse({ dailyCapUsd: 5 }).success, false);
    assert.equal(
      policyPatchSchema.safeParse({ maxStakePerTradeUsd: HARD_DAILY_CAP_USD + 1 }).success,
      false,
    );
    assert.equal(policyPatchSchema.safeParse({ maxStakePerTradeUsd: 0 }).success, false);
    assert.equal(policyPatchSchema.safeParse({ allowedLeagues: ["mlb"] }).success, false);
    assert.equal(policyPatchSchema.safeParse({ hedge: { bogus: 1 } }).success, false);
  });

  void it("accepts a partial hedge patch", () => {
    const r = policyPatchSchema.safeParse({ status: "paused", hedge: { cooldownMinutes: 30 } });
    assert.equal(r.success, true);
  });
});

void describe("hedgePolicyGate", () => {
  const NOW = Date.UTC(2026, 8, 12, 20, 0, 0);
  const view = {
    ...DEFAULT_POLICY,
    hedge: {
      ...DEFAULT_HEDGE_POLICY,
      maxSizeUsd: 20,
      cooldownMinutes: 60,
      dailyBudgetUsd: 50,
      minConfidenceBps: 6000,
      allowedMarketTypes: ["moneyline"],
    },
  };
  const base = {
    sizeUsd: 30,
    marketType: "moneyline",
    confidenceBps: 7000,
    lastHedgeAtMs: null,
    spentTodayUsd: 0,
    nowMs: NOW,
  };

  void it("passes and clamps the size", () => {
    const r = hedgePolicyGate(view, base);
    assert.equal(r.ok, true);
    assert.equal(r.clampedSizeUsd, 20);
  });

  void it("holds non-retryably on paused, market type, and confidence", () => {
    assert.equal(hedgePolicyGate({ ...view, status: "paused" }, base).retryable, false);
    const type = hedgePolicyGate(view, { ...base, marketType: "spread" });
    assert.match(type.reasons.join(";"), /market type spread/);
    assert.equal(type.retryable, false);
    const conf = hedgePolicyGate(view, { ...base, confidenceBps: 5000 });
    assert.match(conf.reasons.join(";"), /confidence 5000/);
    const unknown = hedgePolicyGate(view, { ...base, confidenceBps: null });
    assert.match(unknown.reasons.join(";"), /confidence unknown/);
  });

  void it("holds retryably on cooldown and daily budget, using the clamped size", () => {
    const cool = hedgePolicyGate(view, { ...base, lastHedgeAtMs: NOW - 30 * 60_000 });
    assert.equal(cool.ok, false);
    assert.equal(cool.retryable, true);
    assert.match(cool.reasons.join(";"), /30 min remaining/);
    const ready = hedgePolicyGate(view, { ...base, lastHedgeAtMs: NOW - 61 * 60_000 });
    assert.equal(ready.ok, true);
    const budget = hedgePolicyGate(view, { ...base, spentTodayUsd: 35 });
    assert.equal(budget.ok, false, "35 used + 20 clamped > 50");
    assert.equal(budget.retryable, true);
    const fits = hedgePolicyGate(view, { ...base, spentTodayUsd: 30 });
    assert.equal(fits.ok, true, "30 used + 20 clamped = 50 fits");
  });
});
