import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  needsInput,
  promptText,
  STARTER_PROMPTS,
  STARTER_PROMPTS_TITLE,
} from "./starter-prompts.ts";

void describe("starter prompts", () => {
  void it("are five, numbered in workflow order under the agreed title", () => {
    assert.equal(STARTER_PROMPTS_TITLE, "Start Trading With Your First Five Prompts");
    assert.deepEqual(
      STARTER_PROMPTS.map((p) => p.step),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      STARTER_PROMPTS.map((p) => p.title),
      [
        "Find the games that matter",
        "Build a thesis",
        "Find the trade",
        "Size the position",
        "Execute and manage it",
      ],
    );
  });
  void it("send straight away unless the user must name a game or team", () => {
    assert.deepEqual(STARTER_PROMPTS.map(needsInput), [false, true, true, false, false]);
  });
  void it("send the headline followed by the full instruction", () => {
    const [first] = STARTER_PROMPTS;
    assert.ok(first);
    const text = promptText(first);
    assert.ok(text.startsWith("What sports markets should I be watching today?\n\n"));
    assert.ok(text.endsWith("Cite your sources."));
  });
});
