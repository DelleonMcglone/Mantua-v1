import { strict as assert } from "node:assert";
import { test } from "node:test";
import { placeAnnotations, annotationSummary } from "./detail/chart-annotations.ts";
import { depthRows, depthSummary, metricLines } from "./detail/depth-core.ts";
import { analysisRead, depthRead, historyRows } from "./detail/depth-fixtures.ts";
import type { AnalysisRead, HistoryRow, MarketDepthRead } from "./detail/depth-types.ts";
import { openAll, sectionsFor } from "./detail/disclosure-core.ts";
import { liveGameView } from "./detail/live-game-core.ts";
import { researchView } from "./detail/research-core.ts";
import { historyRowView } from "./history/history-core.ts";

/**
 * Phase 12 (D-008), composed: the three wire reads a market page makes
 * flow through every pure module the page renders from, so each listed
 * data point has a value on one page. The browser spec (client/e2e/
 * market.spec.ts) proves the same over the real components.
 */
const HOME = { key: "nfl:LV", abbreviation: "LV" };
const AWAY = { key: "nfl:KC", abbreviation: "KC" };

test("D-001 / D-006 — price, movement, volume, open interest, and the depth ladder", () => {
  const read = depthRead() as MarketDepthRead;
  const lines = metricLines(read.metrics);
  assert.deepEqual(
    lines.map((l) => `${l.id}=${l.value}`),
    ["price=50¢", "volume=$987.50", "trades=12", "open-interest=3,700 contracts"],
  );
  assert.equal(lines[0]?.hint, "+2.5 pts over 24h");
  assert.equal(depthRows(read.depth).length, 4);
  assert.match(depthSummary(read.depth) ?? "", /\$10,000 of liquidity/);
});

test("D-002 — the live game panel reads score, situation, possession, and the last play", () => {
  const read = depthRead() as MarketDepthRead;
  const v = liveGameView({ league: "nfl", game: read.game, home: HOME, away: AWAY });
  assert.ok(v);
  assert.equal(v.score, "KC 14 · LV 10");
  assert.equal(v.situation, "Q2 · 07:12");
  assert.equal(v.possession, "KC ball");
  const idle = depthRead({ live: false }) as MarketDepthRead;
  assert.equal(liveGameView({ league: "nfl", game: idle.game, home: HOME, away: AWAY }), null);
});

test("D-005 — the chart carries kickoff, a period change, and an injury report", () => {
  const read = depthRead() as MarketDepthRead;
  const t1 = read.computedAt;
  const placed = placeAnnotations(read.annotations, t1 - 2 * 86_400, t1, 640);
  assert.equal(placed.length, 3);
  assert.equal(annotationSummary(placed), "Marked: kickoff, 1 period change, 1 injury report");
});

test("D-003 — research for either side is an agent estimate against the market price", () => {
  const home = researchView(analysisRead(0) as AnalysisRead);
  const away = researchView(analysisRead(1) as AnalysisRead);
  assert.ok(home && away);
  assert.equal(home.probability, "44%");
  assert.equal(home.versusMarket, "Model 6.0 pts below the 50¢ market price");
  assert.equal(away.probability, "56%");
  assert.match(away.action, /value in Kansas City Chiefs/);
});

test("D-004 — every deeper section is available for a traded game and opens together", () => {
  const read = depthRead() as MarketDepthRead;
  const sections = sectionsFor({ hasMarkets: read.hasMarkets, hasResearch: true });
  assert.ok(sections.every((s) => s.available));
  assert.deepEqual(openAll(sections), { depth: true, fees: true, research: true, history: true });
});

test("D-007 — past markets read outcome, settlement, and the closing price", () => {
  const rows = historyRows().rows as HistoryRow[];
  const [won, voided] = rows.map(historyRowView);
  assert.equal(won.outcome, "Buffalo Bills won");
  assert.equal(won.settlement, "Buffalo Bills contracts paid $1.00");
  assert.equal(won.closingPrice, "99¢");
  assert.equal(voided.tone, "void");
  assert.equal(voided.settlement, "Both sides settled at 50¢");
});
