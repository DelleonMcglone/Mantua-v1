import { strict as assert } from "node:assert";
import { test } from "node:test";
import { detectIntent } from "./chat-intent.ts";
import { quickActionsFor, type QuickAction } from "./quick-actions.ts";

const ids = (actions: QuickAction[]) => actions.map((a) => a.id);

test("home offers the six contextual actions (T-016)", () => {
  assert.deepEqual(ids(quickActionsFor({ kind: "home" })), [
    "trade",
    "analyze",
    "swap",
    "add-liquidity",
    "portfolio",
    "agent",
  ]);
});

test("a market page with a selected game makes the actions about that game", () => {
  const actions = quickActionsFor({
    kind: "market",
    sport: "nfl",
    game: { away: "Chiefs", home: "Raiders" },
  });
  const analyze = actions.find((a) => a.id === "analyze");
  assert.ok(analyze);
  assert.match(analyze.command, /Chiefs at Raiders/);
  const agent = actions.find((a) => a.id === "agent");
  assert.ok(agent);
  assert.match(agent.command, /Chiefs/);
});

test("every quick action's command re-detects to the intent it advertises (T-017)", () => {
  const expected: Record<string, string> = {
    trade: "discover",
    analyze: "analyze",
    swap: "swap",
    "add-liquidity": "add-liquidity",
    portfolio: "portfolio",
    agent: "agent",
  };
  for (const ctx of [
    { kind: "home" as const },
    { kind: "market" as const, sport: "nfl" as const, game: { away: "Chiefs", home: "Raiders" } },
    { kind: "analyze" as const },
    { kind: "profile" as const },
  ]) {
    for (const action of quickActionsFor(ctx)) {
      const intent = detectIntent(action.command);
      assert.ok(intent, `${action.id} on ${ctx.kind}: "${action.command}" detected nothing`);
      assert.equal(intent.kind, expected[action.id], `${action.id} on ${ctx.kind}`);
    }
  }
});

test("the current surface's own action is dropped so chips never point at the page you are on", () => {
  assert.ok(!ids(quickActionsFor({ kind: "analyze" })).includes("analyze"));
  assert.ok(!ids(quickActionsFor({ kind: "profile" })).includes("portfolio"));
  assert.ok(!ids(quickActionsFor({ kind: "swap" })).includes("swap"));
});
