import type { ScoredRecord } from "./scoring.ts";

/** Test fixture builder — a scoreable record with sensible defaults. */
export function rec(overrides: Partial<ScoredRecord> & { id: string }): ScoredRecord {
  return {
    sessionId: "s1",
    marketId: `0x${overrides.id}`,
    providerEventId: overrides.id,
    league: "nfl",
    eventStartsAt: new Date("2026-10-25T17:00:00Z"),
    createdAt: new Date("2026-10-24T17:00:00Z"),
    outcomeIndex: 0,
    agentBps: 6000,
    referenceBookBps: 6000,
    referencePoolBps: null,
    closingBps: null,
    liquidityUsdc: 500,
    confidence: "medium",
    source: "research",
    action: "no_trade",
    modelVersion: "v1",
    afterKickoff: false,
    outcome: 1,
    voided: false,
    ...overrides,
  };
}
