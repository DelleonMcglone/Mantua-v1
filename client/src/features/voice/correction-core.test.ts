import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyCorrections } from "./correction-core.ts";

test("a restart marker drops everything said before it (V-006)", () => {
  assert.equal(
    applyCorrections("buy the Jets — scratch that, show me tonight's NFL markets"),
    "show me tonight's NFL markets",
  );
  assert.equal(
    applyCorrections("open the Chiefs page, never mind, show my positions"),
    "show my positions",
  );
});

test("an amount change replaces the amount, keeping the rest of the command", () => {
  assert.equal(
    applyCorrections("buy fifty of the Falcons, no make that twenty"),
    "buy twenty of the Falcons",
  );
  assert.equal(applyCorrections("put $100 on the Chiefs, I mean $25"), "put $25 on the Chiefs");
  assert.equal(
    applyCorrections("sell 30 contracts, sorry I meant 40"),
    "sell 40 contracts",
    "the correction reaches the amount, not the noun after it",
  );
});

test("the last correction wins when a speaker changes their mind twice", () => {
  assert.equal(applyCorrections("buy ten, no make that twenty, no make that thirty"), "buy thirty");
});

test("a marker with nothing to replace leaves the words exactly as spoken", () => {
  // No amount after the marker: guessing here would rewrite the command.
  assert.equal(
    applyCorrections("buy fifty of the Falcons, I mean the Atlanta Falcons"),
    "buy fifty of the Falcons, I mean the Atlanta Falcons",
  );
  // No amount before it either.
  assert.equal(applyCorrections("I mean the Chiefs"), "I mean the Chiefs");
});

test("an ordinary sentence is untouched", () => {
  for (const said of [
    "Should I buy the Falcons YES contract?",
    "Show me the best NFL markets tonight.",
    "What is my position in the Chiefs game",
  ]) {
    assert.equal(applyCorrections(said), said);
  }
});

test("a restart and an amount change compose, restart first", () => {
  assert.equal(
    applyCorrections("show my positions, forget that, buy ten Chiefs, no make that fifty"),
    "buy fifty Chiefs",
  );
});
