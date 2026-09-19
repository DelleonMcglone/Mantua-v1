import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectIssue,
  troubleshoot,
  TROUBLESHOOT_ISSUES,
  type TroubleshootContext,
} from "./troubleshoot.ts";

/** Task 070 / AE-009 — the flows are deterministic over status and account state. */

const open: TroubleshootContext = {
  platform: { mode: "live", trading: "open", reads: "live", message: null },
  account: null,
};
const account = (
  over: Partial<NonNullable<TroubleshootContext["account"]>> = {},
): TroubleshootContext => ({
  ...open,
  account: {
    pendingTransfers: 0,
    failedTransfers: 0,
    pendingTrades: 0,
    hasAgentWallet: true,
    agentMode: "user_testing",
    lastFailure: null,
    ...over,
  },
});

void describe("detectIssue", () => {
  void it("maps common phrasings to an issue and stays silent otherwise", () => {
    assert.equal(detectIssue("my deposit hasn't arrived"), "deposit_pending");
    assert.equal(detectIssue("I can't withdraw"), "withdraw_pending");
    assert.equal(detectIssue("confirm does nothing"), "confirm_not_working");
    assert.equal(detectIssue("my trade is stuck pending"), "trade_pending");
    assert.equal(detectIssue("the mic button is missing"), "voice_unavailable");
    assert.equal(detectIssue("what is a hook"), null);
  });
});

void describe("troubleshoot", () => {
  void it("answers every issue for an anonymous user without throwing", () => {
    for (const issue of TROUBLESHOOT_ISSUES) {
      const r = troubleshoot(issue, open);
      assert.equal(r.issue, issue);
      assert.ok(r.steps.length > 0, issue);
    }
  });

  void it("uses the account: a failed transfer escalates, a pending one explains the timeline", () => {
    const failed = troubleshoot(
      "deposit_pending",
      account({ failedTransfers: 1, lastFailure: "bank declined" }),
    );
    assert.equal(failed.escalate, true);
    assert.match(failed.steps[0], /bank declined/);
    const pending = troubleshoot("withdraw_pending", account({ pendingTransfers: 2 }));
    assert.equal(pending.escalate, false);
    assert.match(pending.steps[0], /2 pending/);
    assert.match(troubleshoot("deposit_pending", account()).steps[0], /No pending deposit/);
  });

  void it("leads with the platform status when trading is not open", () => {
    const halted: TroubleshootContext = {
      ...account({ pendingTrades: 1 }),
      platform: {
        mode: "degraded",
        trading: "buys_halted",
        reads: "delayed",
        message: "Buys halted: NFL feed is delayed.",
      },
    };
    assert.equal(
      troubleshoot("trade_pending", halted).steps[0],
      "Buys halted: NFL feed is delayed.",
    );
    assert.equal(
      troubleshoot("trade_refused", halted).steps[0],
      "Buys halted: NFL feed is delayed.",
    );
    assert.equal(troubleshoot("trade_pending", halted).escalate, true);
  });

  void it("tells a simulation-mode user why confirm executes nothing", () => {
    const r = troubleshoot("confirm_not_working", account({ agentMode: "simulation" }));
    assert.ok(r.steps.some((s) => s.includes("simulation mode")));
    assert.equal(troubleshoot("confirm_not_working", account()).steps.length, 2);
  });

  void it("does not escalate a disabled agent, and points a missing wallet to the Agent page", () => {
    const disabled = troubleshoot("agent_unavailable", account({ agentMode: "disabled" }));
    assert.equal(disabled.escalate, false);
    const noWallet = troubleshoot("agent_unavailable", account({ hasAgentWallet: false }));
    assert.ok(noWallet.steps.some((s) => s.includes("not provisioned")));
  });
});
