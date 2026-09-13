import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ALL_CLOSED, anyOpen, openAll, sectionsFor, toggle } from "./disclosure-core.ts";

/**
 * D-004 — the deeper layer starts closed, opens one section at a time,
 * opens everything for a pro, and never offers a section whose data does
 * not exist for the game.
 */
test("every section starts closed and toggles independently", () => {
  assert.equal(anyOpen(ALL_CLOSED), false);
  const one = toggle(ALL_CLOSED, "depth");
  assert.deepEqual(one, { depth: true, fees: false, research: false, history: false });
  assert.equal(anyOpen(one), true);
  const two = toggle(one, "research");
  assert.equal(two.depth, true);
  assert.equal(two.research, true);
  assert.equal(toggle(two, "depth").depth, false);
});

test("sections name their data dependency and say why one is unavailable", () => {
  const all = sectionsFor({ hasMarkets: true, hasResearch: true });
  assert.deepEqual(
    all.map((s) => s.id),
    ["depth", "fees", "research", "history"],
  );
  assert.ok(all.every((s) => s.available && s.note === null));

  const none = sectionsFor({ hasMarkets: false, hasResearch: false });
  const depth = none.find((s) => s.id === "depth");
  const research = none.find((s) => s.id === "research");
  assert.ok(depth && research);
  assert.equal(depth.available, false);
  assert.match(depth.note ?? "", /market opens/);
  assert.equal(research.available, false);
  assert.equal(none.find((s) => s.id === "fees")?.available, true);
  assert.equal(none.find((s) => s.id === "history")?.available, true);
});

test("open all opens only the available sections", () => {
  const partial = sectionsFor({ hasMarkets: false, hasResearch: true });
  assert.deepEqual(openAll(partial), {
    depth: false,
    fees: true,
    research: true,
    history: true,
  });
});
