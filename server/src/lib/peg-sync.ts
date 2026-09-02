import { createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { env } from "../env.ts";
import { logger } from "./logger.ts";
import { getPythPrice, PYTH_EUR_USD_FEED_ID } from "./pyth-prices.ts";
import { buildPoolKey } from "./pool-key.ts";
import { computePoolId } from "./pool-id.ts";
import { getHookAddress } from "./v4-contracts.ts";
import { DEFAULT_CHAIN_ID } from "./chains.ts";
import { baseRpcClient } from "./rpc-client.ts";

/**
 * Peg-reference keeper for the FX-aware Stable Protection hook.
 *
 * The hook measures depeg against a per-pool EUR/USD reference (see the hook's
 * `setPegReference`). This reads the live EUR/USD from Pyth Hermes (the same
 * source as our price layer) and pushes it on-chain via the owner EOA, so the
 * USDC/EURC pool at the true ~1.14 rate reads HEALTHY instead of tripping the
 * breaker. Runs on an hourly cron, drift-gated: the on-chain ref is read
 * first and the write is skipped when it is within DRIFT_GATE_BPS of the
 * live rate, so cadence doesn't translate into hourly transactions (EUR/USD
 * moves slowly relative to the 5% CRITICAL band). Disabled (503) when
 * `MANTUA_ADMIN_PRIVATE_KEY` is unset or the SP hook has no Base Mainnet
 * deployment yet (STABLE_PROTECTION_HOOK_ADDRESS).
 */

/** Skip the on-chain write when |live − on-chain| / on-chain is below this.
 *  10 bps matches the hook's HEALTHY band edge; the breaker sits at 500. */
const DRIFT_GATE_BPS = 10;

/** SP hook is the recommended hook for USDC/EURC at fee tier 100 (→ DYNAMIC_FEE). */
const SP_FEE_TIER = 100;

const SET_PEG_REFERENCE_ABI = [
  {
    type: "function",
    name: "setPegReference",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "refX18", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export class PegSyncUnavailableError extends Error {
  constructor(message = "Peg-sync keeper is not configured (MANTUA_ADMIN_PRIVATE_KEY unset).") {
    super(message);
    this.name = "PegSyncUnavailableError";
  }
}

export interface PegSyncResult {
  eurUsd: number;
  refX18: string;
  poolId: string;
  hook: string;
  /** Present when a write happened; absent when the drift gate skipped it. */
  txHash?: string;
  skipped: boolean;
  /** |live − on-chain| in basis points of the on-chain ref (Infinity when unset). */
  driftBps: number;
}

/**
 * Drift between the live and on-chain refs in bps of the on-chain value,
 * computed in X18 bigint to avoid float drift. An unset on-chain ref (0)
 * reads as Infinity so the caller always writes it.
 */
export function pegDriftBps(liveX18: bigint, onchainX18: bigint): number {
  if (onchainX18 <= 0n) return Number.POSITIVE_INFINITY;
  const diff = liveX18 > onchainX18 ? liveX18 - onchainX18 : onchainX18 - liveX18;
  return Number((diff * 10_000n) / onchainX18);
}

/** Read EUR/USD from Pyth and push it to the SP hook's peg reference on
 *  Base, unless the on-chain ref is already within the drift gate. */
export async function syncEurUsdPegReference(): Promise<PegSyncResult> {
  const key = env.MANTUA_ADMIN_PRIVATE_KEY;
  if (!key) throw new PegSyncUnavailableError();

  const eurUsd = await getPythPrice(PYTH_EUR_USD_FEED_ID);
  if (!eurUsd || eurUsd <= 0) throw new Error("EUR/USD price unavailable from Pyth Hermes.");
  // Fixed-point 1e18 without float drift: format to 12 dp then scale.
  const refX18 = parseUnits(eurUsd.toFixed(12), 18);

  const spHook = getHookAddress("stable-protection", DEFAULT_CHAIN_ID);
  if (!spHook) {
    throw new PegSyncUnavailableError(
      "Stable Protection hook is not deployed on Base Mainnet yet.",
    );
  }
  const { key: poolKey } = buildPoolKey(
    "USDC",
    "EURC",
    SP_FEE_TIER,
    spHook,
    "stable-protection",
    DEFAULT_CHAIN_ID,
  );
  const poolId = computePoolId(poolKey);

  // Drift gate: skip the write when the on-chain ref is already fresh.
  const onchainRefX18 = await baseRpcClient.readContract({
    address: spHook,
    abi: parseAbi(["function pegReferenceX18(bytes32) view returns (uint256)"]),
    functionName: "pegReferenceX18",
    args: [poolId],
  });
  const driftBps = pegDriftBps(refX18, onchainRefX18);
  if (driftBps < DRIFT_GATE_BPS) {
    logger.info({ eurUsd, driftBps, poolId }, "peg-sync: within drift gate, skipping write");
    return {
      eurUsd,
      refX18: refX18.toString(),
      poolId,
      hook: spHook,
      skipped: true,
      driftBps,
    };
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(env.BASE_RPC_URL),
  });

  const txHash = await wallet.writeContract({
    address: spHook,
    abi: SET_PEG_REFERENCE_ABI,
    functionName: "setPegReference",
    args: [poolId, refX18],
  });

  logger.info(
    { eurUsd, refX18: refX18.toString(), poolId, txHash, driftBps },
    "peg-sync: set EUR/USD ref",
  );
  return {
    eurUsd,
    refX18: refX18.toString(),
    poolId,
    hook: spHook,
    txHash,
    skipped: false,
    driftBps,
  };
}
