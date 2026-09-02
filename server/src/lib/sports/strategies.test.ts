import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStrategy,
  strategyConfigSchema,
  type ArmedStrategy,
  type MarketTick,
  type StrategyConfig,
} from "./strategies.ts";

const MARKET = "0x" + "11".repeat(32);
const MARKET_B = "0x" + "22".repeat(32);
const NOW = 1_800_000_000;

function armed(config: StrategyConfig, overrides: Partial<ArmedStrategy> = {}): ArmedStrategy {
  return { id: "s1", config, capUsd: 100, expiresAtSeconds: null, ...overrides };
}

function tick(overrides: Partial<MarketTick> = {}): MarketTick {
  return { marketId: MARKET, impliedProbBps: 5000, frozen: false, resolved: false, ...overrides };
}

const tpStop: StrategyConfig = {
  kind: "take-profit-stop",
  marketId: MARKET,
  side: "yes",
  takeProfitBps: 8000,
  stopBps: 3000,
};

void describe("strategy config schema (B9-001)", () => {
  void it("requires at least one threshold and stop below take-profit", () => {
    assert.ok(strategyConfigSchema.safeParse(tpStop).success);
    assert.equal(
      strategyConfigSchema.safeParse({ ...tpStop, takeProfitBps: undefined, stopBps: undefined })
        .success,
      false,
    );
    assert.equal(
      strategyConfigSchema.safeParse({ ...tpStop, takeProfitBps: 3000, stopBps: 8000 }).success,
      false,
    );
  });

  void it("delta hedge needs 2+ markets and a positive band", () => {
    assert.ok(
      strategyConfigSchema.safeParse({
        kind: "delta-hedge",
        marketIds: [MARKET, MARKET_B],
        targetNetUsd: 0,
        bandUsd: 50,
      }).success,
    );
    assert.equal(
      strategyConfigSchema.safeParse({
        kind: "delta-hedge",
        marketIds: [MARKET],
        targetNetUsd: 0,
        bandUsd: 50,
      }).success,
      false,
    );
  });
});

void describe("take-profit / stop evaluation (B9-002)", () => {
  void it("triggers take-profit at/above the threshold", () => {
    const d = evaluateStrategy(armed(tpStop), [tick({ impliedProbBps: 8000 })], NOW);
    assert.equal(d.kind, "trigger");
    assert.match((d as { reason: string }).reason, /take-profit/);
  });

  void it("triggers stop at/below the threshold", () => {
    const d = evaluateStrategy(armed(tpStop), [tick({ impliedProbBps: 2999 })], NOW);
    assert.equal(d.kind, "trigger");
    assert.match((d as { reason: string }).reason, /stop/);
  });

  void it("holds between thresholds, and holds without a price", () => {
    assert.equal(evaluateStrategy(armed(tpStop), [tick()], NOW).kind, "hold");
    assert.equal(
      evaluateStrategy(armed(tpStop), [tick({ impliedProbBps: null })], NOW).kind,
      "hold",
    );
  });
});

void describe("safety precedence (B9-007 — P0)", () => {
  void it("kickoff freeze disarms even on the tick that would have fired", () => {
    // 9000bps would trigger take-profit — but the market froze this tick.
    const d = evaluateStrategy(armed(tpStop), [tick({ impliedProbBps: 9000, frozen: true })], NOW);
    assert.deepEqual(d, { kind: "disarm", reason: "market-frozen" });
  });

  void it("a resolved market disarms rather than trades", () => {
    const d = evaluateStrategy(
      armed(tpStop),
      [tick({ impliedProbBps: 9000, resolved: true })],
      NOW,
    );
    assert.deepEqual(d, { kind: "disarm", reason: "market-resolved" });
  });

  void it("expiry disarms before any trigger is considered", () => {
    const d = evaluateStrategy(
      armed(tpStop, { expiresAtSeconds: NOW - 1 }),
      [tick({ impliedProbBps: 9000 })],
      NOW,
    );
    assert.deepEqual(d, { kind: "disarm", reason: "expired" });
  });

  void it("the global kill switch disarms everything, unconditionally", () => {
    const d = evaluateStrategy(armed(tpStop), [tick({ impliedProbBps: 9000 })], NOW, true);
    assert.deepEqual(d, { kind: "disarm", reason: "kill-switch" });
  });

  void it("missing market data holds — never guesses", () => {
    assert.equal(evaluateStrategy(armed(tpStop), [], NOW).kind, "hold");
  });
});

void describe("delta hedge evaluation (B9-003)", () => {
  const hedge: StrategyConfig = {
    kind: "delta-hedge",
    marketIds: [MARKET, MARKET_B],
    targetNetUsd: 0,
    bandUsd: 50,
  };

  void it("rebalances when net exposure leaves the band, capped by the strategy cap", () => {
    const d = evaluateStrategy(
      armed(hedge, { capUsd: 100 }),
      [tick({ netExposureUsd: 400 }), tick({ marketId: MARKET_B, netExposureUsd: -100 })],
      NOW,
    );
    assert.equal(d.kind, "trigger");
    const t = d as { action: string; deltaUsd?: number };
    assert.equal(t.action, "rebalance");
    // Deviation +300 → wants -300, capped to the strategy's 100 USDC ceiling.
    assert.equal(t.deltaUsd, -100);
  });

  void it("holds inside the band and holds when any exposure is unknown", () => {
    assert.equal(
      evaluateStrategy(
        armed(hedge),
        [tick({ netExposureUsd: 20 }), tick({ marketId: MARKET_B, netExposureUsd: 10 })],
        NOW,
      ).kind,
      "hold",
    );
    // One market's exposure missing → hedging a partial picture is worse
    // than not hedging.
    assert.equal(
      evaluateStrategy(
        armed(hedge),
        [tick({ netExposureUsd: 500 }), tick({ marketId: MARKET_B })],
        NOW,
      ).kind,
      "hold",
    );
  });

  void it("freeze on ANY referenced market disarms the whole strategy", () => {
    const d = evaluateStrategy(
      armed(hedge),
      [
        tick({ netExposureUsd: 500 }),
        tick({ marketId: MARKET_B, frozen: true, netExposureUsd: 0 }),
      ],
      NOW,
    );
    assert.deepEqual(d, { kind: "disarm", reason: "market-frozen" });
  });
});

void describe("B10-006 — hedging lifecycle scenario", () => {
  // One strategy across a game day: pre-game drift (hold), a line move
  // (trigger, sized under cap), and kickoff (disarm). The execution leg —
  // turning the trigger into a swap — is gated on the periphery deploy;
  // the decision layer this covers is what will drive it.
  void it("holds through drift, fires on the cross, disarms at kickoff", () => {
    const strategy = armed(tpStop, { capUsd: 50 });

    // Morning: 62% — inside thresholds.
    assert.equal(evaluateStrategy(strategy, [tick({ impliedProbBps: 6200 })], NOW).kind, "hold");
    // Afternoon line move: 81% — take-profit fires.
    const fired = evaluateStrategy(strategy, [tick({ impliedProbBps: 8100 })], NOW + 3600);
    assert.equal(fired.kind, "trigger");
    // Kickoff: even at 90%, the freeze wins.
    const atKickoff = evaluateStrategy(
      strategy,
      [tick({ impliedProbBps: 9000, frozen: true })],
      NOW + 7200,
    );
    assert.deepEqual(atKickoff, { kind: "disarm", reason: "market-frozen" });
  });
});
