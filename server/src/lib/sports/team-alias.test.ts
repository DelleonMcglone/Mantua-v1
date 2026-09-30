/**
 * R-012 — one team key per team across providers. Pinned against the
 * production symptom of 2026-09-30: `nfl:WAS` / `nfl:LA` / `nfl:JAC`
 * (Sportradar) sat beside `nfl:WSH` / `nfl:LAR` / `nfl:JAX` (ESPN) in the
 * teams table, and the same games would have landed twice.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { canonicalAbbreviation } from "./team-alias.ts";
import { teamKey } from "./provider.ts";

void describe("team aliases", () => {
  void it("maps ESPN's three NFL spellings onto the licensed provider's", () => {
    assert.equal(teamKey("nfl", "WSH"), "nfl:WAS");
    assert.equal(teamKey("nfl", "JAX"), "nfl:JAC");
    assert.equal(teamKey("nfl", "LAR"), "nfl:LA");
    assert.equal(teamKey("nfl", "WAS"), "nfl:WAS");
  });

  void it("leaves every other abbreviation alone, upper-cased and trimmed", () => {
    assert.equal(canonicalAbbreviation("nfl", " kc "), "KC");
    assert.equal(teamKey("nfl", "LAC"), "nfl:LAC");
    assert.equal(teamKey("wnba", "LV"), "wnba:LV");
  });

  void it("is per league — a WNBA 'WSH' is not rewritten by the NFL table", () => {
    assert.equal(canonicalAbbreviation("wnba", "WSH"), "WSH");
  });
});
