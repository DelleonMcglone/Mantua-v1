import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messageConfirmsAction } from "./confirmation-language.ts";

/** Phase 8 / A-032 — consent is decided in code, conservatively. */
void describe("messageConfirmsAction", () => {
  void it("accepts explicit, unhedged confirmations", () => {
    for (const msg of [
      "confirm",
      "Confirm.",
      "yes, confirm",
      "I confirm the trade",
      "approved",
      "authorize it",
      "go ahead",
      "yes go ahead and place it",
      "execute it",
      "place the trade",
      "proceed with the swap",
      "yes",
      "Yes please",
    ]) {
      assert.equal(messageConfirmsAction(msg), true, `should confirm: "${msg}"`);
    }
  });

  void it("rejects hedges, questions, negations, and ordinary requests", () => {
    for (const msg of [
      "maybe",
      "looks good",
      "interesting",
      "confirm?",
      "should I confirm?",
      "yes but wait",
      "don't confirm",
      "no, cancel it",
      "confirm — actually never mind",
      "buy 10 USDC of the home side",
      "what does the fee look like",
      "I think so",
      "probably go ahead",
      "hold on",
      "",
      "confirm ".repeat(100),
    ]) {
      assert.equal(messageConfirmsAction(msg), false, `should NOT confirm: "${msg}"`);
    }
  });
});
