import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AnalysisRead } from "./depth-types.ts";
import { actionSentence, evidenceLine, researchView } from "./research-core.ts";

function read(over: Partial<AnalysisRead["analysis"]> = {}, market = 5200): AnalysisRead {
  return {
    status: "ok",
    side: "away",
    team: "Kansas City Chiefs",
    opponent: "Las Vegas Raiders",
    market: { impliedProbabilityBps: market, liquidityUsdc: 6200 },
    analysis: {
      probabilityBps: 5800,
      method: "baseline+adjustments",
      evidence: [
        { factor: "Record", detail: "11–3 vs 6–8", effectBps: 250 },
        { factor: "Injuries", detail: "Chris Jones questionable", effectBps: -100 },
        { factor: "Head to head", detail: "2–2 in recent meetings", effectBps: 0 },
      ],
      riskFactors: ["Thin liquidity: $6,200"],
      discrepancyBps: 600,
      confidence: "medium",
      suggestedAction: { kind: "consider_buy_yes", rationale: "Edge above the threshold." },
      disclaimers: ["Not financial advice."],
      ...over,
    },
  };
}

test("the view carries the estimate, its distance from the market, and the evidence", () => {
  const v = researchView(read());
  assert.ok(v);
  assert.equal(v.probability, "58%");
  assert.equal(v.versusMarket, "Model 6.0 pts above the 52¢ market price");
  assert.deepEqual(
    v.evidence.map((e) => `${e.factor} ${e.effect} ${e.direction}`),
    ["Record +2.5 pts up", "Injuries −1.0 pts down", "Head to head 0.0 pts flat"],
  );
  assert.equal(v.action, "The model sees value in Kansas City Chiefs at this price.");
  assert.deepEqual(v.risks, ["Thin liquidity: $6,200"]);
  assert.deepEqual(v.disclaimers, ["Not financial advice."]);
});

test("small gaps read as in line; no market price reads as such", () => {
  assert.equal(
    researchView(read({ discrepancyBps: 30 }))?.versusMarket,
    "Model in line with the 52¢ market price",
  );
  const unpriced = researchView({
    ...read({ discrepancyBps: null, suggestedAction: { kind: "no_market_price", rationale: "" } }),
    market: null,
  });
  assert.ok(unpriced);
  assert.equal(unpriced.versusMarket, null);
  assert.equal(unpriced.action, "No market price yet to compare the model against.");
});

test("every action kind is a sentence; failed reads have no view", () => {
  assert.match(
    actionSentence(read({ suggestedAction: { kind: "consider_fade", rationale: "" } })),
    /Las Vegas Raiders/,
  );
  assert.equal(
    actionSentence(read({ suggestedAction: { kind: "hold", rationale: "" } })),
    "The model sees no edge over the market.",
  );
  assert.equal(researchView(null), null);
  assert.equal(researchView({ ...read(), status: "not_found" }), null);
  assert.equal(evidenceLine({ factor: "x", detail: "y", effectBps: -5 }).effect, "−0.1 pts");
});
