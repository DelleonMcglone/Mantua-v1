import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DB } from "../../db/client.ts";
import type { NewForecastRow } from "../../db/schema/forecasts.ts";
import { COALESCE_WINDOW_MS, coalescedInsert, makeForecastSink } from "./forecast-sink.ts";

const ok = {
  status: "ok",
  game: { providerEventId: "401", league: "nfl", startsAt: "2026-10-25T17:00:00Z" },
  side: "home",
  team: "A",
  opponent: "B",
  bookLine: null,
  market: null,
  analysis: { probabilityBps: 5500, confidence: "low", evidence: [] },
  inputs: {},
};

void describe("makeForecastSink", () => {
  void it("appends one row per successful analysis, with the tool call in the snapshot", async () => {
    const rows: NewForecastRow[] = [];
    const sink = makeForecastSink(
      {} as DB,
      {
        userId: "u",
        sessionId: "s",
        source: "scan",
        action: "no_trade",
        modelVersion: "v1",
        toolName: "mantua_probability_gaps",
      },
      {
        insert: (_db, row) => {
          rows.push(row);
          return Promise.resolve();
        },
        now: () => new Date("2026-10-24T00:00:00Z"),
      },
    );
    sink.observe(ok, { league: "nfl" });
    sink.observe({ status: "not_found" }, {});
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.source, "scan");
    assert.deepEqual((rows[0]?.inputsSnapshot as { tool: unknown }).tool, {
      name: "mantua_probability_gaps",
      args: { league: "nfl" },
    });
  });

  void it("a failing write never throws into the tool turn", async () => {
    const sink = makeForecastSink(
      {} as DB,
      {
        userId: null,
        sessionId: null,
        source: "research",
        action: "no_trade",
        modelVersion: "v1",
        toolName: "t",
      },
      { insert: () => Promise.reject(new Error("db down")) },
    );
    assert.doesNotThrow(() => {
      sink.observe(ok, {});
    });
    await new Promise((r) => setTimeout(r, 0));
  });

  void it("the migration makes the table append-only at the database (update/delete refused)", () => {
    const sql = readFileSync(
      new URL("../../../drizzle/migrations/0033_forecasts.sql", import.meta.url),
      "utf8",
    );
    assert.match(
      sql,
      /CREATE TRIGGER forecasts_immutable\s+BEFORE UPDATE OR DELETE ON "forecasts"/,
    );
    assert.match(sql, /RAISE EXCEPTION 'forecasts is append-only/);
  });
});

void describe("coalescedInsert (Task 079, F-1)", () => {
  const row = (createdAt: string) =>
    ({
      providerEventId: "401",
      outcomeIndex: 0,
      source: "page",
      modelVersion: "v1",
      createdAt: new Date(createdAt),
    }) as unknown as NewForecastRow;

  void it("skips the write when an equivalent row landed inside the window", async () => {
    const asked: Date[] = [];
    let inserted = 0;
    const insert = coalescedInsert({
      exists: (_db, _row, since) => {
        asked.push(since);
        return Promise.resolve(true);
      },
      insert: () => {
        inserted += 1;
        return Promise.resolve();
      },
    });
    await insert({} as DB, row("2026-10-29T12:00:00Z"));
    assert.equal(inserted, 0);
    // The window is one hour back from the row's own timestamp.
    assert.equal(asked[0]?.toISOString(), "2026-10-29T11:00:00.000Z");
  });

  void it("writes when nothing equivalent is on file", async () => {
    let inserted = 0;
    const insert = coalescedInsert({
      exists: () => Promise.resolve(false),
      insert: () => {
        inserted += 1;
        return Promise.resolve();
      },
    });
    await insert({} as DB, row("2026-10-29T12:00:00Z"));
    assert.equal(inserted, 1);
  });

  void it("defaults to a one-hour window", () => {
    assert.equal(COALESCE_WINDOW_MS, 3_600_000);
  });
});
