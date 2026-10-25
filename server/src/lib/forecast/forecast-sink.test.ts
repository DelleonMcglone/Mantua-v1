import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DB } from "../../db/client.ts";
import type { NewForecastRow } from "../../db/schema/forecasts.ts";
import { makeForecastSink } from "./forecast-sink.ts";

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
