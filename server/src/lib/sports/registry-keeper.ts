/**
 * K-01 — the registry keeper, signing half.
 *
 * Runs on every live-sync tick: reads the chain's keeper candidates (store),
 * the registry's current state for each pool (one read per pool, batched
 * through the client's multicall), plans the writes (registry-keeper-plan),
 * and submits `updateMarket` for each on the market signer — the keeper and
 * the resolver are the same key (DM-103, spec §0.1). Without the signer the
 * tick reports `disabled` and writes nothing, like every other on-chain
 * pass; markets stay closed in that state anyway.
 *
 * Ordering for M-01: a game observed `final` is written FINAL here, on the
 * five-minute tick, long before the daily resolution sweep calls
 * `Resolver.freeze()` — the hook halts on the data, the freeze follows.
 */
import type { DB } from "../../db/client.ts";
import { logger } from "../logger.ts";
import { ARC_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import { getRpcClient } from "../rpc-client.ts";
import { DYNAMIC_MARKET_BY_CHAIN } from "../v4-contracts.ts";
import { REGISTRY_ABI } from "../markets-contracts.ts";
import { marketSignerWallet } from "./markets-onchain.ts";
import { listKeeperCandidates } from "./store.ts";
import { planKeeperWrites, type KeeperInput, type KeeperWrite } from "./registry-keeper-plan.ts";

export interface KeeperTickResult {
  candidates: number;
  planned: number;
  written: number;
  failures: { marketId: string; error: string }[];
  writes: Pick<KeeperWrite, "marketId" | "eventState" | "modelProbability" | "reason">[];
}

export async function runRegistryKeeper(
  db: DB,
  chainId: SupportedChainId = ARC_CHAIN_ID,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  feedDelayed = false,
): Promise<KeeperTickResult | "disabled (no signer)" | "disabled (not deployed)"> {
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!dm) return "disabled (not deployed)";
  const wallet = marketSignerWallet(chainId);
  if (!wallet) return "disabled (no signer)";

  const rows = await listKeeperCandidates(db, chainId);
  const client = getRpcClient(chainId);
  const inputs: KeeperInput[] = await Promise.all(
    rows.map(async (r) => {
      const s = await client.readContract({
        address: dm.registry,
        abi: REGISTRY_ABI,
        functionName: "marketState",
        args: [r.poolId],
      });
      return {
        marketId: r.marketId,
        poolId: r.poolId,
        outcomeIndex: r.outcomeIndex,
        eventStatus: r.eventStatus,
        homeWinProbabilityBps: r.homeWinProbabilityBps,
        openingProbability: r.openingProbability,
        onChain: s.registered
          ? {
              modelProbability: s.modelProbability,
              confidence: s.confidence,
              eventState: s.eventState,
              lastUpdate: Number(s.lastUpdate),
            }
          : null,
      };
    }),
  );

  const plan = planKeeperWrites(inputs, nowSeconds, feedDelayed);
  const result: KeeperTickResult = {
    candidates: rows.length,
    planned: plan.length,
    written: 0,
    failures: [],
    writes: [],
  };
  // Sequential: one nonce stream on the keeper key, and a failed write must
  // not block the others.
  for (const w of plan) {
    try {
      const { request } = await client.simulateContract({
        account: wallet.account,
        address: dm.registry,
        abi: REGISTRY_ABI,
        functionName: "updateMarket",
        args: [w.poolId, w.modelProbability, w.confidence, w.eventState],
      });
      const hash = await wallet.writeContract(request);
      await client.waitForTransactionReceipt({ hash });
      result.written += 1;
      result.writes.push({
        marketId: w.marketId,
        eventState: w.eventState,
        modelProbability: w.modelProbability,
        reason: w.reason,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ marketId: w.marketId, poolId: w.poolId, err }, "keeper: updateMarket failed");
      result.failures.push({ marketId: w.marketId, error });
    }
  }
  if (plan.length > 0) logger.info({ ...result, writes: undefined }, "keeper: tick");
  return result;
}
