import type { DB } from "../../db/client.ts";
import { logger } from "../logger.ts";
import { sharedCache } from "../shared-cache.ts";
import { providerFor } from "../sports/active-provider.ts";
import type { LeagueSlug } from "../sports/provider.ts";
import type { EdgeCandidate } from "./combo-agent.ts";
import { latestPricesBps, legCandidatesFrom, readOpenLegRows } from "./combo-read.ts";
import { LAUNCH_LEAGUE_SLUGS, playoffsLookup } from "./combo-season.ts";

/**
 * Task 072 / CB-006 — the agent's candidate legs: every open market with
 * an upcoming or in-play game, its recorded pool price, and the
 * provider's own win probability as the consensus the edge is measured
 * against. The provider line is the same number the slate seeds pools
 * with; no model estimate enters here.
 */

export const PROPOSAL_HORIZON_SECONDS = 7 * 24 * 3600;
const CONSENSUS_CACHE_MS = 5 * 60_000;

/** Home win probability (bps) per provider event id, from the provider slate. */
async function consensusFor(league: LeagueSlug): Promise<Map<string, number>> {
  const entries = await sharedCache.getOrCompute(
    `combo-consensus:${league}`,
    CONSENSUS_CACHE_MS,
    async (): Promise<[string, number][]> => {
      try {
        const slate = await providerFor(league).getSlate(league);
        return slate.events
          .filter((e) => typeof e.homeWinProbabilityBps === "number")
          .map((e) => [e.providerEventId, e.homeWinProbabilityBps as number]);
      } catch (err) {
        logger.warn({ league, err }, "combos: consensus slate unavailable");
        return [];
      }
    },
  );
  return new Map(entries);
}

export async function readEdgeCandidates(db: DB, nowSeconds: number): Promise<EdgeCandidate[]> {
  const rows = await readOpenLegRows(db, nowSeconds, PROPOSAL_HORIZON_SECONDS);
  const [prices, playoffsOf, ...consensus] = await Promise.all([
    latestPricesBps(
      db,
      rows.map((r) => r.marketId),
    ),
    playoffsLookup(),
    ...LAUNCH_LEAGUE_SLUGS.map((l) => consensusFor(l)),
  ]);
  const homeBps = new Map<string, number>();
  for (const m of consensus) for (const [id, bps] of m) homeBps.set(id, bps);
  return legCandidatesFrom(rows, prices, playoffsOf).map((leg) => {
    const home = homeBps.get(leg.providerEventId);
    return {
      ...leg,
      consensusBps: home === undefined ? null : leg.outcomeIndex === 0 ? home : 10_000 - home,
    };
  });
}
