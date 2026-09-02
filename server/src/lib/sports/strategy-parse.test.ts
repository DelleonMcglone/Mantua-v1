import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStrategyDraft, previewLines } from "./strategy-parse.ts";

void describe("parseStrategyDraft (B9-004)", () => {
  void it("'take profit at 80%' → threshold in bps with the default cap", () => {
    const d = parseStrategyDraft("take profit at 80%");
    assert.deepEqual(d, { kind: "take-profit-stop", takeProfitBps: 8000, capUsd: 100 });
  });

  void it("'close my chiefs position when it hits 85%' → team query + threshold", () => {
    const d = parseStrategyDraft("close my chiefs position when it hits 85%");
    assert.equal(d?.kind, "take-profit-stop");
    assert.equal(d.takeProfitBps, 8500);
    assert.equal(d.teamQuery, "chiefs");
  });

  void it("combined take-profit and stop in one sentence", () => {
    const d = parseStrategyDraft("take profit at 80% and stop loss at 30%, cap $250");
    assert.equal(d?.takeProfitBps, 8000);
    assert.equal(d.stopBps, 3000);
    assert.equal(d.capUsd, 250);
  });

  void it("rejects an inverted pair — stop above take-profit is a mistake, not a strategy", () => {
    assert.equal(parseStrategyDraft("take profit at 30% and stop at 80%"), null);
  });

  void it("'keep my exposure within $50' → delta hedge with target 0", () => {
    const d = parseStrategyDraft("keep my exposure within $50");
    assert.deepEqual(d, { kind: "delta-hedge", targetNetUsd: 0, bandUsd: 50, capUsd: 100 });
  });

  void it("returns null rather than guessing on vague input", () => {
    assert.equal(parseStrategyDraft("hedge my stuff please"), null);
    assert.equal(parseStrategyDraft("take profit soon"), null);
    assert.equal(parseStrategyDraft("stop at 150%"), null);
  });

  void it("preview always states the auto-disarm and confirmation terms", () => {
    const d = parseStrategyDraft("take profit at 80%");
    assert.ok(d);
    const lines = previewLines(d).join("\n");
    assert.match(lines, /Auto-disarms at kickoff/);
    assert.match(lines, /Nothing arms until you confirm/);
    assert.match(lines, /80%/);
  });
});
