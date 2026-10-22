import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backfillMissedFinals, backfillWindow } from "./missed-finals.ts";
import type { DB } from "../../db/client.ts";
import type { ProviderEvent, ProviderSlate } from "./provider.ts";

/** The 2026-10-19 lesson: a final the feed missed must heal within a day. */

const event = (id: string, status: ProviderEvent["status"]): ProviderEvent =>
  ({
    providerEventId: id,
    startsAt: 1_792_429_200, // 2026-10-19 17:00 UTC
    status,
    home: { key: "nfl:ATL", name: "Atlanta Falcons", abbreviation: "ATL" },
    away: { key: "nfl:NYG", name: "New York Giants", abbreviation: "NYG" },
    homeScore: 24,
    awayScore: 10,
  }) as ProviderEvent;

void describe("missed-finals", () => {
  void it("asks for the seven UTC days ending today", () => {
    // 2026-10-22 01:05 UTC (the night the stuck rows were found)
    assert.equal(backfillWindow(1_792_631_100), "20261015-20261022");
    assert.equal(backfillWindow(1_792_631_100, 1), "20261021-20261022");
  });

  void it("reads the dated window through the injected slate and upserts every row", async () => {
    const calls: { league: string; dates: string }[] = [];
    let upserted: readonly ProviderEvent[] = [];
    const result = await backfillMissedFinals({} as DB, "nfl", 1_792_631_100, {
      getSlate: (league, dates) => {
        calls.push({ league, dates });
        const slate: ProviderSlate = {
          provider: "espn",
          league: "nfl",
          events: [event("401873001", "final"), event("401873002", "final")],
          delayed: false,
          fetchedAt: 1_792_631_100_000,
        };
        return Promise.resolve(slate);
      },
      upsert: (_db, provider, _league, events) => {
        assert.equal(provider, "espn");
        upserted = events;
        return Promise.resolve({ inserted: 0, updated: 2, sideConflicts: [] });
      },
    });
    assert.deepEqual(calls, [{ league: "nfl", dates: "20261015-20261022" }]);
    assert.equal(upserted.length, 2);
    assert.deepEqual(result, {
      window: "20261015-20261022",
      provider: "espn",
      delayed: false,
      events: 2,
      inserted: 0,
      updated: 2,
    });
  });
});
