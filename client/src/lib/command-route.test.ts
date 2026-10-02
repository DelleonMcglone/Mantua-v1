import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectIntent } from "./chat-intent.ts";
import { continuesAnalystThread } from "./command-route.ts";

void describe("continuesAnalystThread", () => {
  void it("appends a follow-up question to an open analyst thread", () => {
    // The two questions from the walkthrough: free text, then an analyze intent.
    assert.equal(
      continuesAnalystThread("analyze", detectIntent("what was the score last night?")),
      true,
    );
    assert.equal(continuesAnalystThread("analyze", detectIntent("who was favored to win?")), true);
  });
  void it("does not hijack a command that belongs to another surface", () => {
    assert.equal(continuesAnalystThread("analyze", { kind: "agent" }), false);
    assert.equal(continuesAnalystThread("analyze", { kind: "home" }), false);
  });
  void it("only applies while the analyst is the open route", () => {
    assert.equal(continuesAnalystThread("home", null), false);
    assert.equal(continuesAnalystThread("market", { kind: "analyze" }), false);
  });
});
