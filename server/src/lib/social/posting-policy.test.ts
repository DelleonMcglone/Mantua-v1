import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canPostNow,
  DEFAULT_POSTING_POLICY,
  policyFromJson,
  postingPolicyPatchSchema,
  templateApproved,
} from "./posting-policy.ts";

/**
 * Task 070 / AE-006 — the user's posting policy: which templates the
 * agent may use, how often it may post, and when it must stay quiet.
 */

const at = (iso: string): Date => new Date(iso);

void describe("posting policy", () => {
  void it("defaults to no approved templates, review required, and a conservative cadence", () => {
    assert.deepEqual(DEFAULT_POSTING_POLICY, {
      templates: [],
      maxPostsPerHour: 2,
      maxPostsPerDay: 8,
      minMinutesBetween: 20,
      quietHoursUtc: null,
      requireApproval: true,
    });
    assert.deepEqual(policyFromJson({}), DEFAULT_POSTING_POLICY);
    assert.deepEqual(policyFromJson("garbage"), DEFAULT_POSTING_POLICY);
  });

  void it("merges a stored partial over the defaults and ignores unknown or invalid keys", () => {
    const p = policyFromJson({
      templates: ["market_update"],
      maxPostsPerDay: 3,
      bogus: 1,
      maxPostsPerHour: "x",
    });
    assert.deepEqual(p.templates, ["market_update"]);
    assert.equal(p.maxPostsPerDay, 3);
    assert.equal(p.maxPostsPerHour, 2);
  });

  void it("validates a patch strictly and refuses an empty one", () => {
    assert.equal(postingPolicyPatchSchema.safeParse({}).success, false);
    assert.equal(postingPolicyPatchSchema.safeParse({ maxPostsPerHour: 99 }).success, false);
    assert.equal(postingPolicyPatchSchema.safeParse({ templates: ["nope"] }).success, false);
    assert.equal(
      postingPolicyPatchSchema.safeParse({ quietHoursUtc: { start: 23, end: 6 } }).success,
      true,
    );
  });

  void it("only a template the user approved may post", () => {
    const p = policyFromJson({ templates: ["explain_move"] });
    assert.equal(templateApproved(p, "explain_move"), true);
    assert.equal(templateApproved(p, "market_update"), false);
  });

  void it("enforces spacing, the hourly cap, the daily cap and quiet hours, in that order", () => {
    const p = policyFromJson({ maxPostsPerHour: 2, maxPostsPerDay: 3, minMinutesBetween: 20 });
    const now = at("2026-09-18T15:00:00Z");
    assert.deepEqual(canPostNow(p, [], now), { ok: true });
    assert.deepEqual(canPostNow(p, [at("2026-09-18T14:50:00Z")], now), {
      ok: false,
      reason: "spacing",
    });
    assert.deepEqual(canPostNow(p, [at("2026-09-18T14:30:00Z"), at("2026-09-18T14:10:00Z")], now), {
      ok: false,
      reason: "hourly_cap",
    });
    assert.deepEqual(
      canPostNow(
        p,
        [at("2026-09-18T13:30:00Z"), at("2026-09-18T10:00:00Z"), at("2026-09-18T02:00:00Z")],
        now,
      ),
      { ok: false, reason: "daily_cap" },
    );
    const quiet = policyFromJson({ quietHoursUtc: { start: 23, end: 6 } });
    assert.deepEqual(canPostNow(quiet, [], at("2026-09-18T02:00:00Z")), {
      ok: false,
      reason: "quiet_hours",
    });
    assert.deepEqual(canPostNow(quiet, [], at("2026-09-18T23:30:00Z")), {
      ok: false,
      reason: "quiet_hours",
    });
    assert.deepEqual(canPostNow(quiet, [], at("2026-09-18T12:00:00Z")), { ok: true });
    // Posts older than a day never count.
    assert.deepEqual(canPostNow(p, [at("2026-09-17T14:00:00Z")], now), { ok: true });
  });
});
