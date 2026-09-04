import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentAccountName } from "./agent-wallet-name.ts";
import {
  assertValidDailyCap,
  InvalidDailyCapError,
  messageAttestsCapRaise,
} from "./agent-wallet.ts";
import { HARD_DAILY_CAP_USD } from "./constants.ts";

void describe("deriveAgentAccountName", () => {
  void it("namespaces a UUID under the mantua-agent prefix", () => {
    assert.equal(
      deriveAgentAccountName("550e8400-e29b-41d4-a716-446655440000"),
      "mantua-agent-550e8400-e29b-41d4-a716-446655440000",
    );
  });

  void it("is deterministic for the same input", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    assert.equal(deriveAgentAccountName(id), deriveAgentAccountName(id));
  });
});

// C-010 — the library-layer clamp `updateAgentWalletCap` runs before any
// write: finite, strictly positive, at most the $50k hard ceiling.
void describe("assertValidDailyCap (C-010 clamp)", () => {
  void it("accepts in-range caps, including the exact hard ceiling", () => {
    for (const cap of [0.01, 1, 100, 500, 49_999.99, HARD_DAILY_CAP_USD]) {
      assert.doesNotThrow(() => {
        assertValidDailyCap(cap);
      }, `should accept ${String(cap)}`);
    }
  });

  void it("rejects non-finite values", () => {
    for (const cap of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => {
          assertValidDailyCap(cap);
        },
        InvalidDailyCapError,
        `should reject ${String(cap)}`,
      );
    }
  });

  void it("rejects zero and negative caps", () => {
    for (const cap of [0, -0.01, -100]) {
      assert.throws(
        () => {
          assertValidDailyCap(cap);
        },
        InvalidDailyCapError,
        `should reject ${String(cap)}`,
      );
    }
  });

  void it("rejects anything above the hard ceiling", () => {
    for (const cap of [HARD_DAILY_CAP_USD + 0.01, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      assert.throws(
        () => {
          assertValidDailyCap(cap);
        },
        InvalidDailyCapError,
        `should reject ${String(cap)}`,
      );
    }
  });
});

// C-010 — cap RAISES are attested against the user's own message text, the
// same code-level mechanism as the swap force override: the message must
// mention the cap/limit AND contain the exact new amount.
void describe("messageAttestsCapRaise (C-010 raise attestation)", () => {
  void it("accepts messages that state the new amount in a cap context", () => {
    const cases: [string, number][] = [
      ["raise my daily cap to $500", 500],
      ["set the cap to 500", 500],
      ["increase my spending limit to 1,000 dollars", 1000],
      ["bump the daily limit to $2,500.50", 2500.5],
      ["change my cap to 5k please", 5000],
      ["yes, raise the cap to $50000", 50_000],
    ];
    for (const [msg, cap] of cases) {
      assert.equal(messageAttestsCapRaise(msg, cap), true, `should attest: "${msg}"`);
    }
  });

  void it("rejects generic consent and messages without the amount", () => {
    const cases: [string, number][] = [
      ["yes", 500],
      ["go ahead", 500],
      ["sure, do it", 500],
      ["raise my cap", 500], // no amount stated
      ["raise the cap a bit", 500],
      ["that limit sounds low", 5000],
    ];
    for (const [msg, cap] of cases) {
      assert.equal(messageAttestsCapRaise(msg, cap), false, `should NOT attest: "${msg}"`);
    }
  });

  void it("rejects the amount outside a cap/limit context", () => {
    const cases: [string, number][] = [
      ["send 500 USDC to alice", 500],
      ["swap $500 of USDC for EURC", 500],
      ["I spent 500 yesterday", 500],
    ];
    for (const [msg, cap] of cases) {
      assert.equal(messageAttestsCapRaise(msg, cap), false, `should NOT attest: "${msg}"`);
    }
  });

  void it("rejects a mismatched amount (model asks for more than the user said)", () => {
    assert.equal(messageAttestsCapRaise("raise my daily cap to $500", 5000), false);
    assert.equal(messageAttestsCapRaise("raise my daily cap to $500", 501), false);
    // time-like tokens embedded in words (9pm, 12th) are not amounts
    assert.equal(messageAttestsCapRaise("raise my cap to $500 by 9pm on the 12th", 12), false);
  });

  void it("never attests a non-positive or non-finite target", () => {
    assert.equal(messageAttestsCapRaise("set my cap to 0", 0), false);
    assert.equal(messageAttestsCapRaise("cap NaN", Number.NaN), false);
  });
});
