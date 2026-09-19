import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISCLAIMER } from "./compliance.ts";
import { policyFromJson } from "./posting-policy.ts";
import {
  runPostingTick,
  type CandidatePost,
  type PostRunDeps,
  type PostRunProfile,
} from "./post-run.ts";

/**
 * Task 070 / AE-002 … AE-006 — one scheduler tick over one profile, with
 * every dependency scripted: composed posts go through the lint, the
 * de-duplication window, the cadence gate and the approval setting before
 * anything is sent, and every attempt is recorded whatever happened.
 */

const NOW = new Date("2026-09-18T15:00:00Z");
const ok = (template: CandidatePost["template"], marketId = "0xm1"): CandidatePost => ({
  template,
  marketId,
  text: `NFL: Bills YES at 62% (+4 pts today) vs Chiefs.\n— Sage https://mantua.ai/agents/sage\n${DISCLAIMER}`,
});

interface Recorded {
  template: string;
  marketId: string | null;
  status: string;
  detail: Record<string, unknown>;
  externalId?: string | null | undefined;
}

function profile(over: Partial<PostRunProfile> = {}): PostRunProfile {
  return {
    id: "p1",
    handle: "sage",
    postingEnabled: true,
    policy: policyFromJson({
      templates: ["market_update", "explain_move"],
      requireApproval: false,
    }),
    ...over,
  };
}

function deps(over: Partial<PostRunDeps> & { recorded: Recorded[] }): PostRunDeps {
  const { recorded, ...rest } = over;
  return {
    now: () => NOW,
    candidates: () => Promise.resolve([ok("market_update")]),
    recentPostTimes: () => Promise.resolve([]),
    alreadyCovered: () => Promise.resolve(false),
    send: () => Promise.resolve({ ok: true, id: "x-1" }),
    record: (row) => {
      recorded.push(row);
      return Promise.resolve();
    },
    ...rest,
  };
}

void describe("runPostingTick", () => {
  void it("posts a clean, approved candidate and records it with the platform id", async () => {
    const recorded: Recorded[] = [];
    const summary = await runPostingTick(profile(), deps({ recorded }));
    assert.equal(summary.posted, 1);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].status, "posted");
    assert.equal(recorded[0].externalId, "x-1");
  });

  void it("does nothing for a profile with posting off or no approved templates", async () => {
    const recorded: Recorded[] = [];
    const off = await runPostingTick(profile({ postingEnabled: false }), deps({ recorded }));
    assert.deepEqual(off.skipped, { disabled: 1 });
    const none = await runPostingTick(
      profile({ policy: policyFromJson({ templates: [] }) }),
      deps({ recorded }),
    );
    assert.deepEqual(none.skipped, { disabled: 1 });
    assert.equal(recorded.length, 0);
  });

  void it("records a lint failure and never sends it", async () => {
    const recorded: Recorded[] = [];
    let sent = 0;
    const bad = { ...ok("market_update"), text: "Guaranteed win on the Bills." };
    await runPostingTick(
      profile(),
      deps({
        recorded,
        candidates: () => Promise.resolve([bad]),
        send: () => {
          sent += 1;
          return Promise.resolve({ ok: true, id: "never" });
        },
      }),
    );
    assert.equal(sent, 0);
    assert.equal(recorded[0].status, "rejected_lint");
    assert.ok(Array.isArray(recorded[0].detail["violations"]));
  });

  void it("skips a market/template pair already covered in the window", async () => {
    const recorded: Recorded[] = [];
    const summary = await runPostingTick(
      profile(),
      deps({ recorded, alreadyCovered: () => Promise.resolve(true) }),
    );
    assert.deepEqual(summary.skipped, { duplicate: 1 });
    assert.equal(recorded.length, 0);
  });

  void it("honours the cadence across the tick, counting this tick's own posts", async () => {
    const recorded: Recorded[] = [];
    const summary = await runPostingTick(
      profile({
        policy: policyFromJson({
          templates: ["market_update"],
          requireApproval: false,
          maxPostsPerHour: 1,
          minMinutesBetween: 0,
        }),
      }),
      deps({
        recorded,
        candidates: () => Promise.resolve([ok("market_update", "0xa"), ok("market_update", "0xb")]),
      }),
    );
    assert.equal(summary.posted, 1);
    assert.deepEqual(summary.skipped, { hourly_cap: 1 });
  });

  void it("queues for review instead of sending when the policy requires approval", async () => {
    const recorded: Recorded[] = [];
    let sent = 0;
    const summary = await runPostingTick(
      profile({ policy: policyFromJson({ templates: ["market_update"], requireApproval: true }) }),
      deps({
        recorded,
        send: () => {
          sent += 1;
          return Promise.resolve({ ok: true, id: "never" });
        },
      }),
    );
    assert.equal(sent, 0);
    assert.equal(summary.pendingReview, 1);
    assert.equal(recorded[0].status, "pending_review");
  });

  void it("records a dry run when there is no sender, and a failure when the platform refuses", async () => {
    const recorded: Recorded[] = [];
    const dry = await runPostingTick(profile(), deps({ recorded, send: null }));
    assert.equal(dry.dryRun, 1);
    assert.equal(recorded[0].status, "dry_run");
    const failed = await runPostingTick(
      profile(),
      deps({
        recorded,
        send: () => Promise.resolve({ ok: false, status: 429, error: "Rate limit" }),
      }),
    );
    assert.equal(failed.failed, 1);
    assert.equal(recorded[1].status, "failed");
    assert.equal(recorded[1].detail["status"], 429);
  });
});
