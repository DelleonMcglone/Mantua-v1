/**
 * K-01 — the keeper's signing half with its three dependencies injected:
 * the loop reads the registry, plans, simulates, writes and waits for the
 * receipt; a null wallet short-circuits before any read.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../../db/client.ts";
import { ARC_CHAIN_ID } from "../chains.ts";
import { EVENT_STATE } from "./registry-keeper-plan.ts";
import { runRegistryKeeper, type KeeperDeps } from "./registry-keeper.ts";

const POOL = `0x${"ab".repeat(32)}` as const;
const MARKET = `0x${"cd".repeat(32)}` as const;
const db = {} as DB;

function fakeDeps(state: { registered: boolean; eventState: number; lastUpdate: bigint }) {
  const calls: { fn: string; args?: readonly unknown[] }[] = [];
  const client = {
    readContract: (a: { functionName: string }) => {
      calls.push({ fn: a.functionName });
      return Promise.resolve({ ...state, modelProbability: 5500, confidence: 10_000 });
    },
    simulateContract: (a: { functionName: string; args: readonly unknown[] }) => {
      calls.push({ fn: a.functionName, args: a.args });
      return Promise.resolve({ request: { tag: "req" } });
    },
    waitForTransactionReceipt: () => {
      calls.push({ fn: "receipt" });
      return Promise.resolve({ status: "success" });
    },
  } as unknown as KeeperDeps["client"];
  const wallet = {
    account: { address: "0x4EF85782DE0826BeaF9B40Cc534C9aAf849312C3" },
    writeContract: () => {
      calls.push({ fn: "write" });
      return Promise.resolve("0xhash");
    },
  } as unknown as NonNullable<KeeperDeps["wallet"]>;
  const candidates: KeeperDeps["candidates"] = () =>
    Promise.resolve([
      {
        marketId: MARKET,
        poolId: POOL,
        outcomeIndex: 0,
        marketState: "OPEN",
        openingProbability: 0.55,
        eventStatus: "scheduled",
        startsAt: new Date(),
        homeWinProbabilityBps: null,
      },
    ]);
  return { deps: { client, wallet, candidates }, calls };
}

void describe("runRegistryKeeper (injected deps)", () => {
  void it("writes the opening state for a registered, never-written pool", async () => {
    const { deps, calls } = fakeDeps({ registered: true, eventState: 0, lastUpdate: 0n });
    const r = await runRegistryKeeper(db, ARC_CHAIN_ID, 1_000, false, deps);
    assert.ok(typeof r === "object");
    assert.equal(r.candidates, 1);
    assert.equal(r.written, 1);
    assert.deepEqual(r.failures, []);
    assert.equal(r.writes[0]?.reason, "unregistered-state");
    const sim = calls.find((c) => c.fn === "updateMarket");
    assert.deepEqual(sim?.args, [POOL, 5500, 5_000, EVENT_STATE.PRE_GAME]);
    assert.deepEqual(
      calls.map((c) => c.fn),
      ["marketState", "updateMarket", "write", "receipt"],
    );
  });

  void it("plans nothing for a pool that is current, and never touches a terminal pool", async () => {
    const fresh = fakeDeps({ registered: true, eventState: 0, lastUpdate: 900n });
    const r1 = await runRegistryKeeper(db, ARC_CHAIN_ID, 1_000, false, fresh.deps);
    assert.ok(typeof r1 === "object" && r1.planned === 0 && r1.written === 0);
    const done = fakeDeps({ registered: true, eventState: EVENT_STATE.FINAL, lastUpdate: 1n });
    const r2 = await runRegistryKeeper(db, ARC_CHAIN_ID, 10_000, false, done.deps);
    assert.ok(typeof r2 === "object" && r2.planned === 0);
    assert.ok(!done.calls.some((c) => c.fn === "write"));
  });

  void it("reports a failed write without aborting the tick", async () => {
    const { deps } = fakeDeps({ registered: true, eventState: 0, lastUpdate: 0n });
    deps.client.simulateContract = () => Promise.reject(new Error("NotKeeper()"));
    const r = await runRegistryKeeper(db, ARC_CHAIN_ID, 1_000, false, deps);
    assert.ok(typeof r === "object");
    assert.equal(r.written, 0);
    assert.match(r.failures[0]?.error ?? "", /NotKeeper/);
  });

  void it("is disabled without a signer and reads nothing", async () => {
    const { deps, calls } = fakeDeps({ registered: true, eventState: 0, lastUpdate: 0n });
    const r = await runRegistryKeeper(db, ARC_CHAIN_ID, 1_000, false, { ...deps, wallet: null });
    assert.equal(r, "disabled (no signer)");
    assert.equal(calls.length, 0);
  });
});
