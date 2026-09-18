import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  applyCommitted,
  applyPartial,
  EMPTY_TRANSCRIPT,
  finalText,
  isEmpty,
  joinSpoken,
  transcriptText,
} from "./transcript-core.ts";

test("a partial is replaced as the model revises it, never appended (V-003/V-006)", () => {
  let t = applyPartial(EMPTY_TRANSCRIPT, "show me the");
  assert.equal(transcriptText(t), "show me the");
  t = applyPartial(t, "show me the best");
  assert.equal(transcriptText(t), "show me the best");
  t = applyPartial(t, "show me the best NFL markets");
  assert.equal(transcriptText(t), "show me the best NFL markets");
  assert.equal(t.committed, "", "nothing has settled yet");
});

test("committed segments join with a single space and clear the partial", () => {
  let t = applyCommitted(EMPTY_TRANSCRIPT, "Should I buy");
  t = applyPartial(t, "the Falcons");
  assert.equal(transcriptText(t), "Should I buy the Falcons");

  t = applyCommitted(t, "the Falcons YES contract?");
  assert.equal(t.partial, "", "settling clears the guess it replaced");
  assert.equal(transcriptText(t), "Should I buy the Falcons YES contract?");
});

test("punctuation hugs the word before it", () => {
  assert.equal(joinSpoken("fifty dollars", ", please"), "fifty dollars, please");
  assert.equal(joinSpoken("buy", "the Chiefs"), "buy the Chiefs");
  assert.equal(joinSpoken("", "opening word"), "opening word");
  assert.equal(joinSpoken("trailing", ""), "trailing");
  assert.equal(joinSpoken("fifty", "%"), "fifty%");
});

test("an empty committed message clears the partial without appending", () => {
  const t = applyCommitted(applyPartial(EMPTY_TRANSCRIPT, "uh"), "   ");
  assert.deepEqual(t, { committed: "", partial: "" });
  assert.ok(isEmpty(t));
});

test("only settled text is submitted — an abandoned guess is not the user's words", () => {
  const t = applyPartial(applyCommitted(EMPTY_TRANSCRIPT, "buy the Chiefs"), "for fif");
  assert.equal(transcriptText(t), "buy the Chiefs for fif", "the screen shows everything heard");
  assert.equal(finalText(t), "buy the Chiefs", "the submission carries only what settled");
});
