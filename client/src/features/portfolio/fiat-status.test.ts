import assert from "node:assert/strict";
import test from "node:test";
import { FIAT_STATUSES, fiatStatusClass, fiatStatusLabel } from "./fiat-status.ts";

test("every fiat status has a label and a tone", () => {
  for (const status of FIAT_STATUSES) {
    assert.ok(fiatStatusLabel(status).length > 0);
    assert.ok(fiatStatusClass(status).startsWith("text-"));
  }
});

test("fiat status copy is chainless (F-005)", () => {
  const banned = /wallet|bridge|gas|chain|network|usdc|token/i;
  for (const status of FIAT_STATUSES) {
    assert.equal(banned.test(fiatStatusLabel(status)), false, fiatStatusLabel(status));
  }
});
