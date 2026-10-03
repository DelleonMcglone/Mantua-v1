import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendStep, appendText } from "./message-parts.ts";

void describe("message parts", () => {
  void it("keeps text and tools in the order they arrived", () => {
    let parts = appendText([], "Researching… ");
    parts = appendStep(parts, "t1");
    parts = appendText(parts, "No starters out. ");
    parts = appendStep(parts, "t2");
    parts = appendText(parts, "How would you like ");
    parts = appendText(parts, "to put $100 to work?");
    assert.deepEqual(parts, [
      { kind: "text", text: "Researching… " },
      { kind: "step", id: "t1" },
      { kind: "text", text: "No starters out. " },
      { kind: "step", id: "t2" },
      { kind: "text", text: "How would you like to put $100 to work?" },
    ]);
  });
  void it("merges consecutive text deltas into one segment", () => {
    assert.equal(appendText(appendText([], "a"), "b").length, 1);
  });
});
