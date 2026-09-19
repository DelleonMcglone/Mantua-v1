import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeCadence,
  handleProblem,
  splitPosts,
  toggleTemplate,
  violationLines,
  type PostingPolicy,
  type SocialPost,
} from "./social-core.ts";

/** Task 070 / AE-001, AE-006 — the settings panel's rules and wording, pinned. */

const policy: PostingPolicy = {
  templates: ["market_update"],
  maxPostsPerHour: 2,
  maxPostsPerDay: 8,
  minMinutesBetween: 20,
  quietHoursUtc: { start: 23, end: 6 },
  requireApproval: true,
};

const post = (
  id: string,
  status: SocialPost["status"],
  createdAt: string,
  detail = {},
): SocialPost => ({
  id,
  template: "market_update",
  marketId: "0xm",
  text: "t",
  status,
  detail,
  externalId: null,
  createdAt,
});

void describe("social-core", () => {
  void it("validates a handle the way the server does", () => {
    assert.equal(handleProblem("ab"), "At least 3 characters.");
    assert.equal(handleProblem("a".repeat(25)), "At most 24 characters.");
    assert.equal(handleProblem("Bad-Name"), "Lower-case letters, digits and underscores only.");
    assert.equal(handleProblem("sideline_sage"), null);
  });

  void it("describes the cadence in one line", () => {
    assert.equal(
      describeCadence(policy),
      "up to 2/hour and 8/day · at least 20 min apart · quiet 23:00–06:00 UTC · each post waits for your approval",
    );
    assert.match(
      describeCadence({
        ...policy,
        minMinutesBetween: 0,
        quietHoursUtc: null,
        requireApproval: false,
      }),
      /no minimum gap · no quiet hours · posts go out without review/,
    );
  });

  void it("splits the approval queue from the record, newest first", () => {
    const { pending, history } = splitPosts([
      post("a", "posted", "2026-09-18T10:00:00Z"),
      post("b", "pending_review", "2026-09-18T12:00:00Z"),
      post("c", "rejected_lint", "2026-09-18T11:00:00Z"),
      post("d", "pending_review", "2026-09-18T13:00:00Z"),
    ]);
    assert.deepEqual(
      pending.map((p) => p.id),
      ["d", "b"],
    );
    assert.deepEqual(
      history.map((p) => p.id),
      ["c", "a"],
    );
  });

  void it("reads lint violations from a rejected post and tolerates a missing block", () => {
    const rejected = post("r", "rejected_lint", "2026-09-18T11:00:00Z", {
      violations: [
        { rule: "missing_disclaimer", detail: 'must include "Not betting advice."' },
        "junk",
      ],
    });
    assert.deepEqual(violationLines(rejected), [
      'missing disclaimer: must include "Not betting advice."',
    ]);
    assert.deepEqual(violationLines(post("p", "posted", "2026-09-18T11:00:00Z")), []);
  });

  void it("toggles a template in and out of the approved list", () => {
    assert.deepEqual(toggleTemplate(["market_update"], "explain_move"), [
      "market_update",
      "explain_move",
    ]);
    assert.deepEqual(toggleTemplate(["market_update", "explain_move"], "market_update"), [
      "explain_move",
    ]);
  });
});
