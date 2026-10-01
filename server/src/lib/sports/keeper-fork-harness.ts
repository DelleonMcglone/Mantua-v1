/**
 * K-01 fork-proof harness: an anvil fork of Arc Mainnet with the deployed
 * MarketStateRegistry, its operator impersonated (no key leaves the
 * keystore) so the keeper can be rotated to anvil's public account #0 for
 * the run, plus the per-tick assertion. Used by scripts/keeper-fork-proof.ts.
 */
import { spawn } from "node:child_process";
import { resolveArcAnvil } from "./arc-anvil-bin.ts";
import { createPublicClient, createWalletClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc } from "../arc-chain.ts";
import { ARC_CHAIN_ID } from "../chains.ts";
import { REGISTRY_ABI } from "../markets-contracts.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../v4-contracts.ts";
import type { DB } from "../../db/client.ts";
import { runRegistryKeeper, type KeeperDeps } from "./registry-keeper.ts";

export const FORK_PORT = 8549;
export const FORK_RPC = `http://127.0.0.1:${String(FORK_PORT)}`;
/** anvil's published default account #0 — public, worthless outside a fork. */
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const dm =
  DYNAMIC_MARKET_BY_CHAIN[ARC_CHAIN_ID] ??
  (() => {
    throw new Error("Dynamic Market stack not registered for Arc");
  })();

/** Spawn `arc-anvil` forking Arc Mainnet; resolves to a stop() once it answers. */
export async function startArcFork(): Promise<() => void> {
  const bin = process.env["ARC_ANVIL"] ?? resolveArcAnvil();
  const fork = process.env["KEEPER_FORK_URL"] ?? "https://rpc.mainnet.arc.io";
  const args = ["--fork-url", fork, "--port", String(FORK_PORT), "--chain-id", "5042", "--silent"];
  const child = spawn(bin, args, { stdio: "ignore" });
  child.on("error", () => undefined);
  const probe = createPublicClient({ chain: arc, transport: http(FORK_RPC) });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await probe.getChainId()) === 5042) return () => child.kill();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(
    `${bin} did not answer on ${FORK_RPC} within 30 s (install arc-foundry; see deploy/dynamic-market/README.md)`,
  );
}

/**
 * Rotate the registry keeper to anvil #0 and register one synthetic pool.
 * Time on the fork is the fork's, not this machine's: everything is scheduled
 * from the fork's latest block (`t0`) and `setTime(at)` pins the next mined
 * block to the tick's `at`, so `lastUpdate` on-chain and the planner's clock
 * agree the way they do on Arc.
 */
export async function prepareRegistry() {
  const client = createPublicClient({ chain: arc, transport: http(FORK_RPC) });
  const keeperAccount = privateKeyToAccount(ANVIL_KEY_0);
  const keeper = createWalletClient({
    account: keeperAccount,
    chain: arc,
    transport: http(FORK_RPC),
  });
  const operator = createWalletClient({
    account: dm.operator,
    chain: arc,
    transport: http(FORK_RPC),
  });
  const rpc = (method: string, params: unknown[]) => client.request({ method, params } as never);
  const setTime = (at: number) => rpc("evm_setNextBlockTimestamp", [at]);
  await rpc("anvil_impersonateAccount", [dm.operator]);
  for (const a of [dm.operator, keeperAccount.address])
    await rpc("anvil_setBalance", [a, toHex(10n ** 18n)]);

  const poolId = keccak256(toHex(`keeper-fork-proof:${String(Date.now())}`));
  const send = async (functionName: "setKeeper" | "registerPool", args: readonly unknown[]) => {
    const req = { address: dm.registry, abi: REGISTRY_ABI, functionName, args } as never;
    await client.waitForTransactionReceipt({ hash: await operator.writeContract(req) });
  };
  await send("setKeeper", [keeperAccount.address]);
  const kickoff = BigInt(Number((await client.getBlock()).timestamp) + 3600);
  await send("registerPool", [poolId, kickoff, kickoff + 4n * 3600n, true, 18, false]);

  // The fork's clock after the setup blocks; every tick is scheduled from it
  // (a next-block timestamp in the fork's past is rejected).
  const t0 = Number((await client.getBlock()).timestamp);
  const state = () =>
    client.readContract({
      address: dm.registry,
      abi: REGISTRY_ABI,
      functionName: "marketState",
      args: [poolId],
    });
  return { client, keeper, poolId, registry: dm.registry, state, t0, setTime };
}

export interface StepExpect {
  written: number;
  eventState?: number;
  prob?: number;
  conf?: number;
  reason?: string;
}

/**
 * Run one keeper tick at fork time `at` and compare the result + on-chain
 * state with `expect`; a tick that wrote must also have stamped `lastUpdate`
 * with `at`.
 */
export async function keeperStep(
  name: string,
  at: number,
  deps: KeeperDeps,
  fork: {
    state: () => Promise<{
      eventState: number;
      modelProbability: number;
      confidence: number;
      lastUpdate: bigint;
    }>;
    setTime: (at: number) => Promise<unknown>;
  },
  expect: StepExpect,
): Promise<boolean> {
  await fork.setTime(at);
  const r = await runRegistryKeeper({} as DB, ARC_CHAIN_ID, at, false, deps);
  const s = await fork.state();
  const tick = typeof r === "object" ? r : null;
  const got = {
    written: tick ? tick.written : -1,
    eventState: s.eventState,
    prob: s.modelProbability,
    conf: s.confidence,
    reason: tick ? tick.writes[0]?.reason : r,
  };
  const ok =
    Object.entries(expect).every(([k, v]) => got[k as keyof typeof got] === v) &&
    (got.written === 0 || Number(s.lastUpdate) === at);
  const fails = tick ? tick.failures.map((f) => f.error).join("; ") : "";
  const reason = typeof got.reason === "string" ? got.reason : "";
  const cells = Object.entries({ ...got, lastUpdate: s.lastUpdate, at, reason, fails }).map(
    ([k, v]) => (k === "reason" || k === "fails" ? String(v) : `${k}=${String(v)}`),
  );
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(34)} ${cells.join(" ")}`);
  return ok;
}
