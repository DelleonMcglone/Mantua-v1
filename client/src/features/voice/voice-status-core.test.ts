import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canRetry, isTerminal, noticeFor } from "./voice-status-core.ts";
import type { VoiceFailure } from "./voice-types.ts";

const ALL: VoiceFailure[] = [
  "permission_denied",
  "no_device",
  "not_configured",
  "quota",
  "rate_limited",
  "unavailable",
  "dropped",
];

test("every failure has its own sentence, and none of them is a stack trace (V-010)", () => {
  const seen = new Set<string>();
  for (const failure of ALL) {
    const notice = noticeFor(failure);
    assert.ok(notice.length > 0, failure);
    assert.ok(/[.!]$/.test(notice), `${failure}: reads as a sentence`);
    assert.ok(!seen.has(notice), `${failure}: says something the others do not`);
    seen.add(notice);
  }
});

test("the ones the user can do nothing about say the keyboard still works", () => {
  for (const failure of ["permission_denied", "no_device", "not_configured", "quota"] as const) {
    assert.match(noticeFor(failure), /still type/, failure);
  }
});

test("only the failures a second press cannot fix retire the button", () => {
  assert.ok(isTerminal("permission_denied"));
  assert.ok(isTerminal("no_device"));
  assert.ok(isTerminal("not_configured"));

  assert.ok(!isTerminal("dropped"), "a dropped connection is worth another try");
  assert.ok(!isTerminal("rate_limited"));
  assert.ok(!isTerminal("quota"));
  assert.ok(!isTerminal("unavailable"));
});

test("retry is offered exactly when the failure is not terminal", () => {
  for (const failure of ALL) {
    assert.equal(canRetry(failure), !isTerminal(failure), failure);
  }
});
