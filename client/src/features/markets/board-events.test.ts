import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickBoardEvents } from "./board-events.ts";

const at = (y: number, m: number, d: number, h = 13) =>
  Math.floor(new Date(y, m - 1, d, h, 0, 0).getTime() / 1000);
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 0, 0);
const ids = (r: { events: { id: string }[] }) => r.events.map((e) => e.id);

// Friday 2 Oct 2026: Thursday night is over, Sunday and Monday are ahead.
const friday = day(2026, 10, 2);
const saturday = day(2026, 10, 3);
const schedule = [
  { id: "thu", startsAt: at(2026, 10, 1, 20) },
  { id: "sun-late", startsAt: at(2026, 10, 4, 16) },
  { id: "sun-early", startsAt: at(2026, 10, 4, 13) },
  { id: "mon", startsAt: at(2026, 10, 5, 20) },
];

void describe("pickBoardEvents", () => {
  void it("shows today's games when there are any", () => {
    const sunday = day(2026, 10, 4);
    const r = pickBoardEvents(schedule, sunday, day(2026, 10, 5));
    assert.equal(r.mode, "today");
    assert.deepEqual(ids(r), ["sun-early", "sun-late"]);
  });
  void it("on a day with no games, shows the next game day instead of an empty board", () => {
    const r = pickBoardEvents(schedule, friday, saturday);
    assert.equal(r.mode, "next");
    assert.deepEqual(ids(r), ["sun-early", "sun-late"]);
    assert.equal(r.day?.getTime(), day(2026, 10, 4).getTime());
  });
  void it("never falls back to games that already happened", () => {
    const r = pickBoardEvents([{ id: "thu", startsAt: at(2026, 10, 1, 20) }], friday, saturday);
    assert.equal(r.mode, "empty");
    assert.deepEqual(r.events, []);
  });
  void it("is empty only when the schedule holds nothing ahead", () => {
    assert.equal(pickBoardEvents([], friday, saturday).mode, "empty");
  });
});
