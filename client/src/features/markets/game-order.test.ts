import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orderEvents, parseGameOrder, stepWeek } from "./game-order.ts";

const games = [
  { id: "sun", startsAt: 100 },
  { id: "mon", startsAt: 200 },
  { id: "thu-a", startsAt: 300 },
  { id: "thu-b", startsAt: 300 },
];

void describe("orderEvents", () => {
  void it("runs earliest first by default order", () => {
    assert.deepEqual(
      orderEvents(games, "earliest").map((g) => g.id),
      ["sun", "mon", "thu-a", "thu-b"],
    );
  });
  void it("puts the most recent games on top when latest first", () => {
    assert.deepEqual(
      orderEvents(games, "latest").map((g) => g.id),
      ["thu-a", "thu-b", "mon", "sun"],
    );
  });
  void it("does not mutate its input", () => {
    const copy = [...games];
    orderEvents(games, "latest");
    assert.deepEqual(games, copy);
  });
});

void describe("parseGameOrder", () => {
  void it("defaults to earliest for anything it does not recognise", () => {
    assert.equal(parseGameOrder(null), "earliest");
    assert.equal(parseGameOrder("sideways"), "earliest");
    assert.equal(parseGameOrder("latest"), "latest");
  });
});

void describe("stepWeek", () => {
  const first = { dates: "a" };
  const middle = { dates: "b" };
  const last = { dates: "c" };
  const weeks = [first, middle, last];
  void it("steps to the neighbouring week", () => {
    assert.equal(stepWeek(weeks, middle, 1)?.dates, "c");
    assert.equal(stepWeek(weeks, middle, -1)?.dates, "a");
  });
  void it("stops at either end", () => {
    assert.equal(stepWeek(weeks, last, 1), null);
    assert.equal(stepWeek(weeks, first, -1), null);
  });
});
