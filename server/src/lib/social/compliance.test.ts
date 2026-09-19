import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISCLAIMER, lintPost, MAX_POST_CHARS } from "./compliance.ts";

/**
 * Task 070 / AE-006 — compliance-safe wording. Every post passes this lint
 * before it can leave; the rules are pinned here so a template change
 * that would post a guarantee or an unsubstantiated performance claim
 * fails a test, not a regulator.
 */

const ok = `Bills YES at 62% (+4 pts today), $12.4k in the pool. ${DISCLAIMER}`;

void describe("lintPost", () => {
  void it("passes a plain, sourced market line with the disclaimer", () => {
    assert.deepEqual(lintPost(ok, { ledgerFigures: [] }), { ok: true, violations: [] });
  });

  void it("refuses guarantees, sure things, locks and risk-free language", () => {
    for (const phrase of [
      "guaranteed win",
      "can't lose",
      "sure thing",
      "a lock",
      "risk-free",
      "easy money",
    ]) {
      const r = lintPost(`${phrase}: Bills YES. ${DISCLAIMER}`, { ledgerFigures: [] });
      assert.equal(r.ok, false, phrase);
      assert.ok(
        r.violations.some((v) => v.rule === "forbidden_claim"),
        phrase,
      );
    }
  });

  void it("requires the disclaimer", () => {
    const r = lintPost("Bills YES at 62%.", { ledgerFigures: [] });
    assert.ok(r.violations.some((v) => v.rule === "missing_disclaimer"));
  });

  void it("enforces the platform length", () => {
    const r = lintPost(`${"x".repeat(MAX_POST_CHARS)} ${DISCLAIMER}`, { ledgerFigures: [] });
    assert.ok(r.violations.some((v) => v.rule === "too_long"));
  });

  void it("allows a performance figure only when it comes from the ledger", () => {
    const unsubstantiated = `We are up 40% this season on NFL. ${DISCLAIMER}`;
    const r1 = lintPost(unsubstantiated, { ledgerFigures: [] });
    assert.ok(r1.violations.some((v) => v.rule === "unsubstantiated_performance"));
    const r2 = lintPost(unsubstantiated, { ledgerFigures: ["40%"] });
    assert.equal(r2.ok, true);
    // A dollar P&L figure works the same way.
    const pnl = `Track record: +$212.50 realised over 14 markets. ${DISCLAIMER}`;
    assert.equal(lintPost(pnl, { ledgerFigures: [] }).ok, false);
    assert.equal(lintPost(pnl, { ledgerFigures: ["+$212.50", "14"] }).ok, true);
  });

  void it("does not mistake a market probability for a performance claim", () => {
    const r = lintPost(`Chiefs YES moved from 55% to 61% in the last hour. ${DISCLAIMER}`, {
      ledgerFigures: [],
    });
    assert.equal(r.ok, true);
  });

  void it("refuses advice phrased as an instruction to bet", () => {
    const r = lintPost(`Bet the Bills now. ${DISCLAIMER}`, { ledgerFigures: [] });
    assert.ok(r.violations.some((v) => v.rule === "directive_advice"));
  });
});
