import { strict as assert } from "node:assert";
import { test } from "node:test";
import { freshness } from "./freshness.ts";

const NOW = 1_800_000_000_000;

test("a fresh read says when it was updated (T-023)", () => {
  const f = freshness({ fetchedAt: NOW - 20_000 }, NOW);
  assert.equal(f.label, "Updated just now");
  assert.equal(f.stale, false);
  assert.equal(f.delayed, false);
});

test("an older read shows the relative age and flips stale past five minutes", () => {
  assert.equal(freshness({ fetchedAt: NOW - 2 * 60_000 }, NOW).label, "Updated 2m ago");
  const old = freshness({ fetchedAt: NOW - 6 * 60_000 }, NOW);
  assert.equal(old.stale, true);
});

test("a delayed slate reports the ingest time it is as of", () => {
  const f = freshness({ fetchedAt: NOW, dataAsOf: NOW - 3 * 3_600_000, delayed: true }, NOW);
  assert.equal(f.delayed, true);
  assert.equal(f.label, "Data as of 3h ago");
});

test("seconds-based timestamps are accepted too", () => {
  const f = freshness({ fetchedAt: Math.floor((NOW - 90_000) / 1000) }, NOW);
  assert.equal(f.label, "Updated 1m ago");
});

test("no timestamp at all is honest about it", () => {
  const f = freshness({}, NOW);
  assert.equal(f.label, "Update time unknown");
  assert.equal(f.stale, true);
});
