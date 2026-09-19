import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executionModeOf, LEDGER_MODES } from "./execution-mode.ts";

/**
 * Task 070 / AE-013 — how a fill came to be, read from its audit row.
 * The mapping is the only place the public ledger learns a trade's mode,
 * so every branch is pinned here.
 */

void describe("executionModeOf", () => {
  void it("labels a fill with no audit row as unattributed — never assumed confirmed", () => {
    assert.equal(executionModeOf(undefined), "unattributed");
  });

  void it("labels a hedge-engine fill autonomous (armed in advance, fired by a tick)", () => {
    assert.equal(executionModeOf({ action: "strategy_execute", params: {} }), "autonomous");
    assert.equal(executionModeOf({ action: "strategy_close", params: {} }), "autonomous");
  });

  void it("labels an agent trade carrying a confirmation id user_confirmed, whatever the mode", () => {
    const params = {
      tool: "mantua_execute_trade",
      args: { confirmationId: "c1" },
      mode: "autonomous",
    };
    assert.equal(executionModeOf({ action: "agent_market_trade", params }), "user_confirmed");
  });

  void it("labels an autonomous-mode agent trade without a confirmation autonomous", () => {
    const params = { tool: "mantua_execute_trade", args: { amount: "5" }, mode: "autonomous" };
    assert.equal(executionModeOf({ action: "agent_market_trade", params }), "autonomous");
  });

  void it("refuses to guess when neither a confirmation nor the autonomous mode is recorded", () => {
    const params = { tool: "mantua_execute_trade", args: { amount: "5" }, mode: "user_testing" };
    assert.equal(executionModeOf({ action: "agent_market_trade", params }), "unattributed");
    // A lifted confirmation id survives the args cap; truncated args alone cannot be read.
    const lifted = { tool: "mantua_execute_trade", argsTruncated: "{…", confirmationId: "c2" };
    assert.equal(
      executionModeOf({ action: "agent_market_trade", params: lifted }),
      "user_confirmed",
    );
    const truncated = { tool: "mantua_execute_trade", argsTruncated: "{…", mode: "user_testing" };
    assert.equal(
      executionModeOf({ action: "agent_market_trade", params: truncated }),
      "unattributed",
    );
  });

  void it("labels any other audit action unattributed", () => {
    assert.equal(executionModeOf({ action: "swap", params: {} }), "unattributed");
  });

  void it("exports the four modes the public page renders", () => {
    assert.deepEqual(
      [...LEDGER_MODES],
      ["simulated", "user_confirmed", "autonomous", "unattributed"],
    );
  });
});
