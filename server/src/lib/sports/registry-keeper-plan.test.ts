/**
 * K-01 — the keeper planner. What it must never do: rewrite a terminal
 * pool, downgrade FINAL, or spend a transaction on noise. What it must
 * always do: write a never-written pool, follow a state change, keep the
 * on-chain state inside §22's staleness window.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CONFIDENCE,
  EVENT_STATE,
  PROBABILITY_DELTA_BPS,
  REFRESH_AFTER_SECONDS,
  eventStateFor,
  planKeeperWrites,
  yesProbabilityBps,
  type KeeperInput,
} from "./registry-keeper-plan.ts";

const NOW = 1_800_000_000;
const MARKET = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const POOL = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

function input(over: Partial<KeeperInput> = {}): KeeperInput {
  return {
    marketId: MARKET,
    poolId: POOL,
    outcomeIndex: 0,
    eventStatus: "scheduled",
    homeWinProbabilityBps: 6200,
    openingProbability: 0.55,
    onChain: {
      modelProbability: 6200,
      confidence: 10_000,
      eventState: EVENT_STATE.PRE_GAME,
      lastUpdate: NOW - 60,
    },
    ...over,
  };
}

void describe("eventStateFor", () => {
  void it("maps the canonical statuses onto the registry enum", () => {
    assert.equal(eventStateFor("scheduled"), EVENT_STATE.PRE_GAME);
    assert.equal(eventStateFor("in_progress"), EVENT_STATE.LIVE);
    assert.equal(eventStateFor("final"), EVENT_STATE.FINAL);
    assert.equal(eventStateFor("postponed"), EVENT_STATE.VOID);
    assert.equal(eventStateFor("cancelled"), EVENT_STATE.VOID);
    assert.equal(eventStateFor("unknown-thing"), EVENT_STATE.PRE_GAME);
  });
});

void describe("yesProbabilityBps", () => {
  void it("prefers the live home-win probability and complements it for the away side", () => {
    assert.deepEqual(
      yesProbabilityBps({ outcomeIndex: 0, homeWinProbabilityBps: 6200, openingProbability: 0.5 }),
      { bps: 6200, source: "live" },
    );
    assert.deepEqual(
      yesProbabilityBps({ outcomeIndex: 1, homeWinProbabilityBps: 6200, openingProbability: 0.5 }),
      { bps: 3800, source: "live" },
    );
  });

  void it("falls back to the opening probability, clamps, and reports nothing when neither exists", () => {
    assert.deepEqual(
      yesProbabilityBps({ outcomeIndex: 0, homeWinProbabilityBps: null, openingProbability: 0.55 }),
      { bps: 5500, source: "opening" },
    );
    assert.deepEqual(
      yesProbabilityBps({
        outcomeIndex: 0,
        homeWinProbabilityBps: 12_000,
        openingProbability: null,
      }),
      { bps: 10_000, source: "live" },
    );
    assert.equal(
      yesProbabilityBps({ outcomeIndex: 0, homeWinProbabilityBps: null, openingProbability: null }),
      null,
    );
  });
});

void describe("planKeeperWrites", () => {
  void it("writes a registered-but-never-written pool (the §22 trap) and skips unregistered ones", () => {
    const never = input({
      onChain: { modelProbability: 0, confidence: 0, eventState: 0, lastUpdate: 0 },
    });
    const unregistered = input({
      marketId: "0x3333333333333333333333333333333333333333333333333333333333333333",
      onChain: null,
    });
    const plan = planKeeperWrites([never, unregistered], NOW, false);
    assert.equal(plan.length, 1);
    assert.equal(plan[0]?.reason, "unregistered-state");
    assert.equal(plan[0]?.modelProbability, 6200);
    assert.equal(plan[0]?.confidence, CONFIDENCE.live);
  });

  void it("follows a state change: scheduled → in play → final, and never rewrites a terminal pool", () => {
    const live = planKeeperWrites([input({ eventStatus: "in_progress" })], NOW, false);
    assert.equal(live[0]?.reason, "state-change");
    assert.equal(live[0]?.eventState, EVENT_STATE.LIVE);
    const final = planKeeperWrites(
      [
        input({
          eventStatus: "final",
          onChain: {
            modelProbability: 6200,
            confidence: 10_000,
            eventState: EVENT_STATE.LIVE,
            lastUpdate: NOW - 60,
          },
        }),
      ],
      NOW,
      false,
    );
    assert.equal(final[0]?.eventState, EVENT_STATE.FINAL);
    // Already FINAL on-chain: nothing, whatever the feed says now.
    const after = planKeeperWrites(
      [
        input({
          eventStatus: "scheduled",
          onChain: {
            modelProbability: 6200,
            confidence: 10_000,
            eventState: EVENT_STATE.FINAL,
            lastUpdate: NOW - 60,
          },
        }),
      ],
      NOW,
      false,
    );
    assert.deepEqual(after, []);
  });

  void it("spends a transaction on a probability move, not on noise", () => {
    const noise = input({ homeWinProbabilityBps: 6200 + PROBABILITY_DELTA_BPS - 1 });
    const move = input({ homeWinProbabilityBps: 6200 + PROBABILITY_DELTA_BPS });
    assert.deepEqual(planKeeperWrites([noise], NOW, false), []);
    assert.equal(planKeeperWrites([move], NOW, false)[0]?.reason, "probability-move");
  });

  void it("refreshes inside the staleness window and not before", () => {
    const fresh = input({
      onChain: {
        modelProbability: 6200,
        confidence: 10_000,
        eventState: 0,
        lastUpdate: NOW - REFRESH_AFTER_SECONDS + 1,
      },
    });
    const due = input({
      onChain: {
        modelProbability: 6200,
        confidence: 10_000,
        eventState: 0,
        lastUpdate: NOW - REFRESH_AFTER_SECONDS,
      },
    });
    assert.deepEqual(planKeeperWrites([fresh], NOW, false), []);
    assert.equal(planKeeperWrites([due], NOW, false)[0]?.reason, "refresh");
    const staleAfter: number = 900; // spec §22 STALE_AFTER
    assert.ok(
      (REFRESH_AFTER_SECONDS as number) < staleAfter,
      "must sit inside spec §22 STALE_AFTER",
    );
  });

  void it("lowers confidence on the opening fallback and on a delayed feed", () => {
    const opening = planKeeperWrites(
      [
        input({
          homeWinProbabilityBps: null,
          onChain: { modelProbability: 0, confidence: 0, eventState: 0, lastUpdate: 0 },
        }),
      ],
      NOW,
      false,
    );
    assert.equal(opening[0]?.confidence, CONFIDENCE.opening);
    const delayed = planKeeperWrites(
      [input({ onChain: { modelProbability: 0, confidence: 0, eventState: 0, lastUpdate: 0 } })],
      NOW,
      true,
    );
    assert.equal(delayed[0]?.confidence, CONFIDENCE.delayed);
  });
});
