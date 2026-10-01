/**
 * K-01 — the registry keeper proven on an Arc fork.
 * `npm run keeper:fork-proof -w @mantua/server`
 *
 * Sign-off addendum C §C8 item 1 asks for the keeper tick "proven on a fork
 * and on Arc". This is the fork half: it runs the REAL server loop
 * (`runRegistryKeeper`: read → plan → simulate → write → receipt) against
 * an anvil fork of Arc Mainnet and the deployed MarketStateRegistry, and
 * asserts the on-chain state after every tick:
 *
 *   1. a freshly registered pool gets its opening state (PRE_GAME, 5500)
 *   2. the same tick again plans nothing (nothing changed)
 *   3. ten minutes later the state is refreshed (REFRESH_AFTER_SECONDS)
 *   4. kickoff: LIVE at the provider's probability, full confidence
 *   5. the final whistle: FINAL — the data-driven halt the hook keys on
 *   6. nothing is ever written to a FINAL pool again
 *
 * Needs `arc-anvil` (Arc's native-USDC gas) on PATH or at `ARC_ANVIL`;
 * forks `KEEPER_FORK_URL` (default the public Arc RPC). No secret is read
 * or printed. Exit 0 = every step matched; 1 = a mismatch or failed write.
 */
import { keccak256, toHex } from "viem";
import type { KeeperCandidateRow } from "../lib/sports/store.ts";
import {
  CONFIDENCE,
  EVENT_STATE,
  REFRESH_AFTER_SECONDS,
} from "../lib/sports/registry-keeper-plan.ts";
import {
  FORK_RPC,
  keeperStep,
  prepareRegistry,
  startArcFork,
} from "../lib/sports/keeper-fork-harness.ts";

async function main() {
  const stop = await startArcFork();
  try {
    const { client, keeper, poolId, registry, state, t0, setTime } = await prepareRegistry();
    const now = t0;
    console.log(
      `fork ${FORK_RPC} · registry ${registry} · pool ${poolId.slice(0, 10)}… · keeper → anvil #0`,
    );

    const row: KeeperCandidateRow = {
      marketId: keccak256(toHex("keeper-fork-proof-market")),
      poolId,
      outcomeIndex: 0,
      marketState: "OPEN",
      openingProbability: 0.55,
      eventStatus: "scheduled",
      startsAt: new Date((now + 3600) * 1000),
      homeWinProbabilityBps: null,
    };
    const deps = { wallet: keeper, client, candidates: () => Promise.resolve([row]) };
    const step = (name: string, at: number, expect: Parameters<typeof keeperStep>[4]) =>
      keeperStep(name, at, deps, { state, setTime }, expect);

    const results: boolean[] = [];
    results.push(
      await step("1 opening state on a new pool", now + 30, {
        written: 1,
        eventState: EVENT_STATE.PRE_GAME,
        prob: 5500,
        conf: CONFIDENCE.opening,
        reason: "unregistered-state",
      }),
    );
    results.push(
      await step("2 same tick again: nothing", now + 31, {
        written: 0,
        eventState: EVENT_STATE.PRE_GAME,
      }),
    );
    results.push(
      await step("3 refresh after 600 s", now + 30 + REFRESH_AFTER_SECONDS, {
        written: 1,
        reason: "refresh",
      }),
    );
    row.eventStatus = "in_progress";
    row.homeWinProbabilityBps = 6200;
    results.push(
      await step("4 kickoff → LIVE, provider prob", now + 3700, {
        written: 1,
        eventState: EVENT_STATE.LIVE,
        prob: 6200,
        conf: CONFIDENCE.live,
        reason: "state-change",
      }),
    );
    row.eventStatus = "final";
    row.homeWinProbabilityBps = 10_000;
    results.push(
      await step("5 final whistle → FINAL", now + 15_000, {
        written: 1,
        eventState: EVENT_STATE.FINAL,
        prob: 10_000,
        reason: "state-change",
      }),
    );
    row.homeWinProbabilityBps = 4000;
    results.push(
      await step("6 FINAL is never rewritten", now + 20_000, {
        written: 0,
        eventState: EVENT_STATE.FINAL,
        prob: 10_000,
      }),
    );

    const failed = results.filter((ok) => !ok).length;
    console.log(
      failed === 0
        ? "keeper fork proof: PASS"
        : `keeper fork proof: FAIL (${String(failed)} step(s))`,
    );
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    stop();
  }
}

main().catch((err: unknown) => {
  console.error("keeper fork proof: error", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
