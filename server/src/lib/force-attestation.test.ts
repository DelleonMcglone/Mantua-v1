import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messageAuthorizesForce } from "./force-attestation.ts";

void describe("messageAuthorizesForce", () => {
  void it("accepts explicit override wording", () => {
    for (const msg of [
      "force the swap",
      "I understand the risk, override the guard",
      "yes I insist, do it",
      "do it anyway",
      "swap them anyway please",
      "proceed anyway, I accept the loss",
      "skip the guard this once",
      "bypass the safety check",
      "ignore the warning and execute",
      "I accept the risk",
      "FORCE it",
    ]) {
      assert.equal(messageAuthorizesForce(msg), true, `should authorize: "${msg}"`);
    }
  });

  void it("rejects generic consent and ordinary requests", () => {
    for (const msg of [
      "yes",
      "go ahead",
      "sounds good",
      "swap 50 USDC for cirBTC",
      "please execute the swap",
      "sure, do it",
      "that's fine with me",
      "ok proceed",
      "what's the risk?",
      "the workforce is large", // \b keeps 'force' from matching inside words
      "overriding CSS styles is annoying",
    ]) {
      assert.equal(messageAuthorizesForce(msg), false, `should NOT authorize: "${msg}"`);
    }
  });
});
