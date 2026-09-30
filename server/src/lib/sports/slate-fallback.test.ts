/**
 * R-012 — the slate refresh falls through a dark primary to the next
 * provider, reports who served, and only fails when nobody answers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { refreshSlateWithFallback } from "./slate-fallback.ts";
import {
  ProviderUnavailableError,
  type LeagueSlug,
  type ProviderSlate,
  type SportsDataProvider,
} from "./provider.ts";

const datesSeen: Record<string, string | undefined> = {};
function provider(name: string, behaviour: "ok" | "unavailable" | "throws"): SportsDataProvider {
  return {
    name,
    leagues: ["nfl"],
    getSlate(league: LeagueSlug, dates?: string): Promise<ProviderSlate> {
      datesSeen[name] = dates;
      if (behaviour === "unavailable") {
        return Promise.reject(new ProviderUnavailableError(`${name}: HTTP 429`));
      }
      if (behaviour === "throws") return Promise.reject(new Error(`${name}: boom`));
      return Promise.resolve({ provider: name, league, events: [], delayed: false, fetchedAt: 0 });
    },
    getEvent: () => Promise.resolve(null),
  };
}

void describe("refreshSlateWithFallback", () => {
  void it("serves from the primary when it answers, skipping nothing", async () => {
    const out = await refreshSlateWithFallback(
      [provider("sportradar", "ok"), provider("espn", "ok")],
      "nfl",
      0,
    );
    assert.equal(out.served.name, "sportradar");
    assert.equal(out.refresh.provider, "sportradar");
    assert.deepEqual(out.skipped, []);
  });

  void it("falls through an out-of-quota primary to the fallback and says so", async () => {
    const out = await refreshSlateWithFallback(
      [provider("sportradar", "unavailable"), provider("espn", "ok")],
      "nfl",
      0,
    );
    assert.equal(out.served.name, "espn");
    assert.deepEqual(out.skipped, ["sportradar"]);
  });

  void it("propagates the last error when every provider fails — the tick's failure path is unchanged", async () => {
    await assert.rejects(
      refreshSlateWithFallback(
        [provider("sportradar", "unavailable"), provider("espn", "throws")],
        "nfl",
        0,
      ),
      /espn: boom/,
    );
  });

  void it("refuses an empty chain", async () => {
    await assert.rejects(refreshSlateWithFallback([], "nfl", 0), /no provider configured/);
  });
});

void describe("refreshSlateWithFallback — backfill window", () => {
  void it("hands the dates window to every provider it tries", async () => {
    await refreshSlateWithFallback(
      [provider("sportradar", "unavailable"), provider("espn", "ok")],
      "nfl",
      0,
      undefined,
      "20260924-20260929",
    );
    assert.equal(datesSeen["sportradar"], "20260924-20260929");
    assert.equal(datesSeen["espn"], "20260924-20260929");
  });
});
