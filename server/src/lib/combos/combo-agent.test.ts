import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_COMBO_POLICY } from "./combo-policy.ts";
import {
  MIN_EDGE_BPS,
  edgeBps,
  proposalStakeUsd,
  proposeCombo,
  type EdgeCandidate,
} from "./combo-agent.ts";

/** Task 072 / CB-006 — the proposal picks legs by edge under the policy. */

const NOW = 1_800_000_000;
function cand(
  id: string,
  team: string,
  priceBps: number,
  consensusBps: number | null,
  over: Partial<EdgeCandidate> = {},
): EdgeCandidate {
  return {
    marketId: `0x${id}`,
    providerEventId: `g${id}`,
    outcomeIndex: 0,
    teamName: team,
    opponentName: `${team}-opp`,
    league: "nfl",
    kickoffAt: NOW + 3600,
    marketState: "OPEN",
    eventStatus: "scheduled",
    priceBps,
    consensusBps,
    playoffs: false,
    ...over,
  };
}
const policy = {
  status: "active" as const,
  allowedLeagues: [],
  combo: DEFAULT_COMBO_POLICY,
  riskLevel: "balanced" as const,
  maxStakePerTradeUsd: 40,
};
const platform = { maxLegs: 6, maxStakeUsd: 500 };
const candidates = [
  cand("a", "A", 5_000, 5_600), // +600
  cand("b", "B", 6_000, 6_200), // +200
  cand("c", "C", 4_000, 4_100), // +100 — below the edge floor
  cand("d", "D", 3_000, 3_900), // +900
  cand("e", "E", 5_000, null), // unknown consensus
  cand("f", "F", 5_500, 6_000, { providerEventId: "gd" }), // same game as D
];

void describe("proposeCombo", () => {
  void it("ranks by edge, skips correlated and edgeless legs, sizes by risk level", () => {
    const p = proposeCombo({ candidates, policy, platform, openExposureUsd: 0, nowSeconds: NOW });
    assert.equal(p.ok, true);
    assert.deepEqual(
      p.legs.map((l) => l.leg.teamName),
      ["D", "A", "B"],
    );
    assert.equal(p.stakeUsd, 20);
    assert.equal(p.fairProbabilityBps, 900);
    assert.equal(p.estimatedPayoutUsd, 222.2);
    assert.match(
      p.rationale[0] ?? "",
      /D over D-opp: pool 3000 bps vs consensus 3900 bps \(\+900 bps edge\)/,
    );
  });

  void it("conservative takes two legs and a quarter of the per-trade limit", () => {
    const p = proposeCombo({
      candidates,
      policy: { ...policy, riskLevel: "conservative" },
      platform,
      openExposureUsd: 0,
      nowSeconds: NOW,
    });
    assert.equal(p.ok, true);
    assert.equal(p.legs.length, 2);
    assert.equal(p.stakeUsd, 10);
  });

  void it("refuses without two edged legs, without headroom, or over the payout limit", () => {
    const none = proposeCombo({
      candidates: candidates.slice(1, 3),
      policy,
      platform,
      openExposureUsd: 0,
      nowSeconds: NOW,
    });
    assert.equal(none.ok, false);
    const full = proposeCombo({
      candidates,
      policy,
      platform,
      openExposureUsd: 100,
      nowSeconds: NOW,
    });
    assert.equal(full.ok, false);
    assert.match(full.reasons[0], /headroom/);
    const capped = proposeCombo({
      candidates,
      policy: { ...policy, combo: { ...DEFAULT_COMBO_POLICY, maxPayoutUsd: 50 } },
      platform,
      openExposureUsd: 0,
      nowSeconds: NOW,
    });
    assert.equal(capped.ok, false);
  });

  void it("edge and stake helpers", () => {
    assert.equal(edgeBps({ consensusBps: 5_600, priceBps: 5_000 }), 600);
    assert.equal(edgeBps({ consensusBps: null, priceBps: 5_000 }), null);
    assert.equal(MIN_EDGE_BPS, 150);
    assert.equal(proposalStakeUsd({ ...policy, riskLevel: "aggressive" }, platform, 90), 10);
  });
});
