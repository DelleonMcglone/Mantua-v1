import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { outcomeFromResolution } from "./outcome-store.ts";

void describe("outcomeFromResolution", () => {
  void it("a resolve names the winner; a void (or a resolve with no index) is voided", () => {
    assert.deepEqual(outcomeFromResolution({ kind: "resolve", outcome: 1 }), {
      winningOutcomeIndex: 1,
      voided: false,
    });
    assert.deepEqual(outcomeFromResolution({ kind: "resolve", outcome: 0 }), {
      winningOutcomeIndex: 0,
      voided: false,
    });
    assert.deepEqual(outcomeFromResolution({ kind: "void", outcome: null }), {
      winningOutcomeIndex: null,
      voided: true,
    });
    assert.deepEqual(outcomeFromResolution({ kind: "resolve", outcome: null }), {
      winningOutcomeIndex: null,
      voided: true,
    });
  });
});
