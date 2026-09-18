import { strict as assert } from "node:assert";
import { test } from "node:test";
import { speechIsAssentOnly } from "./confirm-guard.ts";

test("a bare assent is caught, so a speaker is never misled into thinking they confirmed (V-009)", () => {
  for (const said of [
    "confirm",
    "Confirm.",
    "yes",
    "Yes!",
    "yeah",
    "yep",
    "ok",
    "Okay",
    "sure",
    "do it",
    "Go ahead",
    "send it",
    "execute",
    "approve",
  ]) {
    assert.ok(speechIsAssentOnly(said), said);
  }
});

test("a command that merely begins with assent is a command and goes through", () => {
  for (const said of [
    "yes, show me tonight's games",
    "ok buy ten of the Chiefs",
    "sure, what is my position",
    "confirm my email address",
    "Should I buy the Falcons YES contract?",
    "Show me the best NFL markets tonight",
  ]) {
    assert.ok(!speechIsAssentOnly(said), said);
  }
});

test("an empty or whitespace utterance is not assent", () => {
  assert.ok(!speechIsAssentOnly(""));
  assert.ok(!speechIsAssentOnly("   "));
});
