/**
 * The on-chain half of the market lifecycle: creation via the MarketFactory
 * and settlement via the Resolver, signed with `MARKET_SIGNER_PRIVATE_KEY`
 * (the Resolver's authorised signer).
 *
 * Kept deliberately thin: everything decidable is decided in the pure
 * planners (`planMarkets`, `planResolution`) that already have their own
 * tests — this module only turns decisions into transactions. Every write
 * simulates first so a revert surfaces as a per-item failure instead of
 * burning gas, matching `executeResolution`'s isolation contract.
 */

import { createWalletClient, encodePacked, http, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { env } from "../../env.ts";
import type { DB } from "../../db/client.ts";
import {
  agentWallets,
  marketPositions,
  markets as marketsSchema,
  resolutions,
} from "../../db/schema/index.ts";
import { logAudit } from "../audit.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "../chains.ts";
import { registerDynamicTargets } from "../circle/allowed-targets.ts";
import { executeAgentCalldata } from "../circle/execute.ts";
import { logger } from "../logger.ts";
import { getRpcClient } from "../rpc-client.ts";
import {
  redeemCalldata,
  redeemFunctionForOnchainState,
  settlementPriceFor,
} from "./market-redeem.ts";
import {
  ERC20_APPROVE_ABI,
  LP_ROUTER_ABI,
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  MARKET_ABI,
  MARKET_FACTORY_ABI,
  MARKET_SPLIT_ABI,
  POOL_MANAGER_INIT_ABI,
  REGISTRY_ABI,
  RESOLVER_CONTRACT_ABI,
  STATE_VIEW_ABI,
} from "../markets-contracts.ts";
import { DYNAMIC_MARKET_BY_CHAIN, POOL_SWAP_TEST_ABI } from "../v4-contracts.ts";
import { planMarketPool } from "./market-pool.ts";
import { assertUsdcCollateral } from "./market-trade-build.ts";
import { planRebandSwap } from "./reband.ts";
import type { PlannedMarket } from "./ingest.ts";
import type { ResolutionPlan, ResolutionSubmitter } from "./resolution.ts";

/** Null when no configured key derives to the chain's authorised operator —
 *  callers degrade to planning.
 *
 *  The key is routed by DERIVED ADDRESS, not blindly trusted: it signs only
 *  if it is the chain's Resolver-authorised operator
 *  (`DYNAMIC_MARKET_BY_CHAIN[chainId].operator`). This guard is
 *  load-bearing — a mispasted key is refused loudly instead of silently
 *  signing transactions the Resolver will reject. */
export function marketSignerWallet(chainId: SupportedChainId = BASE_CHAIN_ID) {
  const operator = DYNAMIC_MARKET_BY_CHAIN[chainId]?.operator.toLowerCase();
  if (!operator) return null;
  const key = env.MARKET_SIGNER_PRIVATE_KEY;
  if (key) {
    const account = privateKeyToAccount(key as `0x${string}`);
    if (account.address.toLowerCase() === operator) {
      return createWalletClient({ account, chain: base, transport: http(env.BASE_RPC_URL) });
    }
  }
  logger.warn(
    { chainId, operator },
    "markets: no configured signer key derives to this chain's operator — degrading to planning",
  );
  return null;
}

/** The chain's markets/periphery/dynamic-market config, or throw. The
 *  Base Mainnet deployment is pending (docs/tasks/v2-roadmap.md), so today
 *  this always throws and callers degrade to planning/read-only paths. */
function marketsCfg(chainId: SupportedChainId) {
  const markets = MARKETS_BY_CHAIN[chainId];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[chainId];
  const dm = DYNAMIC_MARKET_BY_CHAIN[chainId];
  if (!markets || !periphery || !dm) {
    throw new Error(`Sports markets are not deployed on chain ${String(chainId)}`);
  }
  const { poolSwapTest, poolModifyLiquidityTest } = periphery;
  if (!poolSwapTest || !poolModifyLiquidityTest) {
    throw new Error(`Sports-market routers are not deployed on chain ${String(chainId)}`);
  }
  // C-004 — every seed/reclaim/reband leg splits, LPs, and merges the
  // deployment's collateral; refuse a deployment not denominated in the
  // chain's canonical USDC.
  assertUsdcCollateral(chainId, markets.collateral);
  return { markets, periphery: { ...periphery, poolSwapTest, poolModifyLiquidityTest }, dm };
}

/**
 * The markets worth submitting: `createMarketIfAbsent` reverts StartInPast,
 * so games at/past kickoff are filtered here — they missed their window and
 * simply never get a market. Pure, for tests.
 */
export function creatableMarkets(
  planned: readonly PlannedMarket[],
  nowSeconds: number = Math.floor(Date.now() / 1000),
): PlannedMarket[] {
  return planned.filter((m) => m.kickoffTimestamp > nowSeconds);
}

export interface OnChainMarketDetail {
  marketId: `0x${string}`;
  providerEventId: string;
  outcomeIndex: number;
  marketAddress: `0x${string}`;
  yesToken: `0x${string}`;
  noToken: `0x${string}`;
  poolId: `0x${string}`;
  openingProbability: number;
}

export interface MarketCreationSummary {
  submitted: number;
  created: number;
  existed: number;
  skippedPastKickoff: number;
  poolsOpened: number;
  poolsSeeded: number;
  /** Every market this sweep touched, for DB persistence — the resolutions
   *  log FK-requires a markets row, so rows must exist before settlement. */
  details: OnChainMarketDetail[];
  failures: { marketId: string; error: string }[];
}

/** Four-hour window mirrors the test harness; resolution can run later —
 *  the registry timestamp only drives the hook's near-resolution premium. */
const RESOLUTION_WINDOW_SECONDS = 4 * 3600;

/** Seed liquidity FULL-range (v4 min/max usable ticks at 60 spacing).
 *  A bounded band (±11520, p ≈ 0.09–0.91) made every quote that would push
 *  the price past the band revert `NotEnoughLiquidity` — on 1-USDC-deep
 *  pools that was any bet over ~$0.50. Full range means a quote
 *  always succeeds; a large bet pays visible slippage instead of erroring,
 *  which is the right failure mode for a thin book. */
const SEED_TICK = 887_220;
/** Target pool liquidity per seed budget: the split burns half the budget
 *  into YES+NO, the LP leg pairs YES with the remaining USDC, and 1.8×
 *  headroom keeps the amounts affordable at any in-range opening price.
 *  (The previous seed/3 sizing used ~15% of what the budget could buy.) */
function seedTargetLiquidity(seed: bigint): bigint {
  return (seed * 9n) / 20n;
}

async function writeAndWait(
  wallet: NonNullable<ReturnType<typeof marketSignerWallet>>,
  request: unknown,
  chainId: SupportedChainId,
): Promise<void> {
  const tx = await wallet.writeContract(request as never);
  await getRpcClient(chainId).waitForTransactionReceipt({ hash: tx });
}

/**
 * Seed a freshly opened pool with a sliver of protocol liquidity so the
 * market is actually tradeable at its opening odds — a pool with a price
 * but no liquidity fills nothing. The signer splits MARKET_SEED_USDC into
 * a full YES/NO set and LPs the YES side with USDC across a wide range.
 * L = seed/3 keeps the worst-case single-sided requirement under the
 * split amount at any clamped opening probability. Idempotent by the
 * liquidity check: already-seeded pools are skipped.
 */
async function seedPoolLiquidity(
  wallet: NonNullable<ReturnType<typeof marketSignerWallet>>,
  marketAddress: `0x${string}`,
  plan: ReturnType<typeof planMarketPool>,
  chainId: SupportedChainId,
): Promise<boolean> {
  const seed = BigInt(env.MARKET_SEED_USDC);
  if (seed === 0n) return false;
  const cfg = marketsCfg(chainId);
  const client = getRpcClient(chainId);

  const liquidity = await client.readContract({
    address: cfg.periphery.stateView,
    abi: STATE_VIEW_ABI,
    functionName: "getLiquidity",
    args: [plan.poolId],
  });
  // Heal to target, don't just fire once: a pool seeded under an older
  // (thinner) sizing, or while the signer was short, deepens on the next
  // sweep instead of being skipped forever.
  const target = seedTargetLiquidity(seed);
  if (liquidity >= target) return false;
  const delta = target - liquidity;
  // The split burns `splitAmount` USDC into YES+NO; the LP leg then needs
  // up to ~1.8× `delta` of each side at in-range extremes, which
  // `splitAmount = 2×delta ≥ 1.8×delta` affords with margin.
  const splitAmount = delta * 2n;

  const approveThenCall = async (token: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: token,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, amount],
    });
    await writeAndWait(wallet, request, chainId);
  };

  // 1. Split USDC into YES + NO (NO stays with the signer; only the
  //    YES/USDC pool exists — DM-101's complementary market covers NO).
  await approveThenCall(cfg.markets.collateral, marketAddress, splitAmount);
  const { request: splitReq } = await client.simulateContract({
    account: wallet.account,
    address: marketAddress,
    abi: MARKET_SPLIT_ABI,
    functionName: "split",
    args: [splitAmount],
  });
  await writeAndWait(wallet, splitReq, chainId);

  // 2. LP: approve both sides to the liquidity router and add.
  const yesToken = plan.yesIsToken0 ? plan.key.currency0 : plan.key.currency1;
  await approveThenCall(yesToken, cfg.periphery.poolModifyLiquidityTest, splitAmount);
  await approveThenCall(cfg.markets.collateral, cfg.periphery.poolModifyLiquidityTest, splitAmount);
  const { request: lpReq } = await client.simulateContract({
    account: wallet.account,
    address: cfg.periphery.poolModifyLiquidityTest,
    abi: LP_ROUTER_ABI,
    functionName: "modifyLiquidity",
    args: [
      plan.key,
      {
        tickLower: -SEED_TICK,
        tickUpper: SEED_TICK,
        liquidityDelta: delta,
        salt: `0x${"00".repeat(32)}`,
      },
      "0x",
    ],
  });
  await writeAndWait(wallet, lpReq, chainId);
  return true;
}

/**
 * B1-009 — open the market's YES/USDC pool at the provider's implied
 * probability. Idempotent: an already-registered pool is skipped, an
 * already-initialized pool surfaces as a simulate revert and is treated as
 * done. Register-then-initialize order matters — the hook's beforeInitialize
 * consults the registry.
 */
async function bootstrapMarketPool(
  wallet: NonNullable<ReturnType<typeof marketSignerWallet>>,
  marketAddress: `0x${string}`,
  m: PlannedMarket,
  chainId: SupportedChainId,
): Promise<{
  opened: boolean;
  plan: ReturnType<typeof planMarketPool>;
  yesToken: `0x${string}`;
  noToken: `0x${string}`;
}> {
  const cfg = marketsCfg(chainId);
  const client = getRpcClient(chainId);
  const yesToken = await client.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "yesToken",
  });
  const noToken = await client.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "noToken",
  });
  const plan = planMarketPool(yesToken, cfg.markets.collateral, cfg.dm.hook, m.openingProbability);

  const registered = await client.readContract({
    address: cfg.dm.registry,
    abi: REGISTRY_ABI,
    functionName: "isRegistered",
    args: [plan.poolId],
  });
  if (!registered) {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: cfg.dm.registry,
      abi: REGISTRY_ABI,
      functionName: "registerPool",
      args: [
        plan.poolId,
        BigInt(m.kickoffTimestamp),
        BigInt(m.kickoffTimestamp + RESOLUTION_WINDOW_SECONDS),
        plan.yesIsToken0,
        6,
        // D-105 season switch — once-only, from the league calendar (H-010).
        m.playoffs,
      ],
    });
    const tx = await wallet.writeContract(request);
    await client.waitForTransactionReceipt({ hash: tx });
  }

  try {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: cfg.dm.poolManager,
      abi: POOL_MANAGER_INIT_ABI,
      functionName: "initialize",
      args: [plan.key, plan.sqrtPriceX96],
    });
    const tx = await wallet.writeContract(request);
    await client.waitForTransactionReceipt({ hash: tx });
    logger.info(
      { marketId: m.marketId, poolId: plan.poolId, probability: m.openingProbability },
      "markets: pool opened at implied probability",
    );
    return { opened: true, plan, yesToken, noToken };
  } catch {
    // Already initialized — a previous half-completed run; done is done.
    return { opened: false, plan, yesToken, noToken };
  }
}

/**
 * Idempotent on-chain sweep: one `createMarketIfAbsent` per planned market.
 * The factory's absent-check makes re-runs free of duplicates, so this can
 * ride every sports-sync tick.
 */
export async function createMarketsOnChain(
  planned: readonly PlannedMarket[],
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<MarketCreationSummary | null> {
  const wallet = marketSignerWallet(chainId);
  if (!wallet) return null;
  const cfg = marketsCfg(chainId);
  const client = getRpcClient(chainId);

  const now = Math.floor(Date.now() / 1000);
  const todo = creatableMarkets(planned, now);
  const summary: MarketCreationSummary = {
    submitted: 0,
    created: 0,
    existed: 0,
    skippedPastKickoff: planned.length - todo.length,
    poolsOpened: 0,
    poolsSeeded: 0,
    details: [],
    failures: [],
  };

  for (const m of todo) {
    try {
      let marketAddress = await client.readContract({
        address: cfg.markets.factory,
        abi: MARKET_FACTORY_ABI,
        functionName: "marketOf",
        args: [m.marketId],
      });
      if (marketAddress !== "0x0000000000000000000000000000000000000000") {
        summary.existed += 1;
      } else {
        const { request } = await client.simulateContract({
          account: wallet.account,
          address: cfg.markets.factory,
          abi: MARKET_FACTORY_ABI,
          functionName: "createMarketIfAbsent",
          args: [m.marketId, BigInt(m.kickoffTimestamp), m.label],
        });
        const txHash = await wallet.writeContract(request);
        await client.waitForTransactionReceipt({ hash: txHash });
        marketAddress = await client.readContract({
          address: cfg.markets.factory,
          abi: MARKET_FACTORY_ABI,
          functionName: "marketOf",
          args: [m.marketId],
        });
        summary.submitted += 1;
        summary.created += 1;
        logger.info({ marketId: m.marketId, label: m.label, txHash }, "markets: created on-chain");
      }
      // Pool bootstrap + seed run for existing markets too — a
      // half-completed earlier sweep heals on the next tick.
      const boot = await bootstrapMarketPool(wallet, marketAddress, m, chainId);
      if (boot.opened) summary.poolsOpened += 1;
      if (await seedPoolLiquidity(wallet, marketAddress, boot.plan, chainId)) {
        summary.poolsSeeded += 1;
      }
      summary.details.push({
        marketId: m.marketId,
        providerEventId: m.providerEventId,
        outcomeIndex: m.outcomeIndex,
        marketAddress,
        yesToken: boot.yesToken,
        noToken: boot.noToken,
        poolId: boot.plan.poolId,
        openingProbability: m.openingProbability,
      });
    } catch (err) {
      summary.failures.push({
        marketId: m.marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

/**
 * The live `ResolutionSubmitter` against the deployed Resolver, or null
 * without a signer. Freeze treats a revert as "already done" per the port's
 * contract (idempotent sweep); resolve/void simulate first so a revert is a
 * clean per-market failure for `executeResolution` to isolate.
 */
export function liveResolutionSubmitter(
  chainId: SupportedChainId = BASE_CHAIN_ID,
): ResolutionSubmitter | null {
  const wallet = marketSignerWallet(chainId);
  if (!wallet) return null;
  const cfg = marketsCfg(chainId);
  const client = getRpcClient(chainId);

  const write = async (
    functionName: "freeze" | "resolve" | "voidMarket",
    args: readonly unknown[],
  ): Promise<string> => {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: cfg.markets.resolver,
      abi: RESOLVER_CONTRACT_ABI,
      functionName,
      // viem's tuple-typed args don't unify across the three overloads here.
      args: args as never,
    });
    const txHash = await wallet.writeContract(request);
    await client.waitForTransactionReceipt({ hash: txHash });
    return txHash;
  };

  return {
    signerAddress: () => wallet.account.address,
    async freeze(marketId) {
      try {
        return await write("freeze", [marketId]);
      } catch {
        // Already frozen / not yet due / already resolved — the sweep is
        // idempotent and a no-op freeze is success, not an error.
        return null;
      }
    },
    // S-025: the only argument `resolve` accepts is a ResolutionAuthorization
    // minted by `assertResolutionCriteria` — this call site cannot be reached
    // without the criteria gate having passed.
    resolve: (auth) => write("resolve", [auth.marketId, auth.outcome]),
    void: (marketId) => write("voidMarket", [marketId]),
  };
}

/**
 * Restrict a resolution plan to markets that exist on-chain. Games finished
 * before market creation went live (or whose creation failed) plan resolves
 * for markets that were never minted; submitting those burns an RPC
 * simulation per market per tick and reports as failures. `marketOf` reads
 * batch through the client's multicall, so this is one call, not N.
 */

// ─── Liquidity recycling (settled-market sweeper) ────────────────────────

/** The tick ranges seeds have ever been placed at, newest first: full-range
 *  (current sizing) and the legacy ±11520 band. A pool can hold a position
 *  at each (band seed + full-range top-up), so reclaim checks both. */
const SEED_RANGES: readonly number[] = [887_220, 11_520];
const SEED_SALT = `0x${"00".repeat(32)}` as const;

const ERC20_BALANCE_OF_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
]);

/** v4 Position.calculatePositionKey: keccak256(abi.encodePacked(owner,
 *  tickLower, tickUpper, salt)). Owner is the LP router — the test router
 *  holds every position opened through it. */
function positionKey(owner: `0x${string}`, tickLower: number, tickUpper: number): `0x${string}` {
  return keccak256(
    encodePacked(
      ["address", "int24", "int24", "bytes32"],
      [owner, tickLower, tickUpper, SEED_SALT],
    ),
  );
}

export interface ReclaimCandidate {
  marketId: string;
  yesToken: string | null;
  noToken: string | null;
}

export interface ReclaimSummary {
  scanned: number;
  liquidityWithdrawn: number;
  redeemed: number;
  skippedActive: number;
  failures: { marketId: string; error: string }[];
}

/**
 * Recycle the signer's capital out of finished markets: withdraw the seed
 * LP positions, then redeem the signer's outcome tokens for USDC
 * (`redeem` on RESOLVED/SETTLED, `redeemInvalid` on INVALID). Runs before
 * the day's seeding so yesterday's float funds today's books instead of
 * fresh treasury top-ups.
 *
 * Idempotent by on-chain state: a reclaimed market has zero position
 * liquidity and zero signer token balances, so re-scanning it costs only
 * reads. OPEN/FROZEN markets are skipped — their capital is still working.
 */
export async function reclaimSettledMarkets(
  candidates: readonly ReclaimCandidate[],
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<ReclaimSummary | null> {
  const wallet = marketSignerWallet(chainId);
  if (!wallet) return null;
  const cfg = marketsCfg(chainId);
  const client = getRpcClient(chainId);
  const lpRouter = cfg.periphery.poolModifyLiquidityTest;
  const signer = wallet.account.address;

  const summary: ReclaimSummary = {
    scanned: 0,
    liquidityWithdrawn: 0,
    redeemed: 0,
    skippedActive: 0,
    failures: [],
  };

  for (const m of candidates) {
    summary.scanned += 1;
    try {
      const market = await client.readContract({
        address: cfg.markets.factory,
        abi: MARKET_FACTORY_ABI,
        functionName: "marketOf",
        args: [m.marketId as `0x${string}`],
      });
      if (market === "0x0000000000000000000000000000000000000000") continue;
      const state = await client.readContract({
        address: market,
        abi: MARKET_ABI,
        functionName: "state",
      });
      // Market.State: 0 OPEN, 1 FROZEN, 2 RESOLVED, 3 SETTLED, 4 INVALID.
      if (state === 0 || state === 1) {
        summary.skippedActive += 1;
        continue;
      }
      const yesToken = (m.yesToken ??
        (await client.readContract({
          address: market,
          abi: MARKET_ABI,
          functionName: "yesToken",
        }))) as `0x${string}`;
      const plan = planMarketPool(yesToken, cfg.markets.collateral, cfg.dm.hook, 0.5);

      for (const range of SEED_RANGES) {
        const positionLiquidity = await client.readContract({
          address: cfg.periphery.stateView,
          abi: STATE_VIEW_ABI,
          functionName: "getPositionLiquidity",
          args: [plan.poolId, positionKey(lpRouter, -range, range)],
        });
        if (positionLiquidity === 0n) continue;
        const { request } = await client.simulateContract({
          account: wallet.account,
          address: lpRouter,
          abi: LP_ROUTER_ABI,
          functionName: "modifyLiquidity",
          args: [
            plan.key,
            {
              tickLower: -range,
              tickUpper: range,
              liquidityDelta: -positionLiquidity,
              salt: SEED_SALT,
            },
            "0x",
          ],
        });
        await writeAndWait(wallet, request, chainId);
        summary.liquidityWithdrawn += 1;
      }

      // Redeem whatever outcome tokens the signer now holds. redeem()
      // reverts NothingToRedeem on a zero balance, so gate on balances.
      const noToken = (m.noToken ??
        (await client.readContract({
          address: market,
          abi: MARKET_ABI,
          functionName: "noToken",
        }))) as `0x${string}`;
      const [yesBal, noBal] = await Promise.all(
        [yesToken, noToken].map((t) =>
          client.readContract({
            address: t,
            abi: ERC20_BALANCE_OF_ABI,
            functionName: "balanceOf",
            args: [signer],
          }),
        ),
      );
      const fn = state === 4 ? "redeemInvalid" : "redeem";
      if (yesBal > 0n || noBal > 0n) {
        try {
          const { request } = await client.simulateContract({
            account: wallet.account,
            address: market,
            abi: MARKET_ABI,
            functionName: fn,
          });
          await writeAndWait(wallet, request, chainId);
          summary.redeemed += 1;
        } catch {
          // Holding only the losing side is normal — nothing to redeem.
        }
      }
    } catch (err) {
      summary.failures.push({
        marketId: m.marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (summary.liquidityWithdrawn > 0 || summary.redeemed > 0) {
    logger.info({ chainId, ...summary }, "markets: reclaimed settled-market capital");
  }
  return summary;
}

// ─── Re-banding (open-market price-band sweeper) ─────────────────────────

/** Per-market spend ceiling per tick. A pathologically deep book (someone
 *  LP'd big against the seed) must not drain the whole signer float on one
 *  market — the price limit makes a partial re-band safe, and the next tick
 *  continues the walk. */
const REBAND_MAX_INPUT_PER_MARKET = 50_000_000n; // 50 USDC

export interface RebandSummary {
  scanned: number;
  /** Overpriced pools sold back down toward REBAND_HIGH_TARGET. */
  soldDown: number;
  /** Underpriced pools bought back up toward REBAND_LOW_TARGET. */
  boughtUp: number;
  /** Markets where leftover YES+NO sets were merged back to USDC. */
  merged: number;
  skippedInBand: number;
  skippedNoBudget: number;
  failures: { marketId: string; error: string }[];
}

/**
 * Push OPEN markets whose pool price escaped the [0, 1] YES-price band back
 * inside it (see reband.ts for why nothing else will). The signer plays the
 * riskless arb both directions:
 *
 *  - above the band: split USDC 1 → 1 YES + 1 NO, sell YES into the pool
 *    with the swap's price limit pinned at the target — every YES sells at
 *    ≥ ~0.99 while the retained NO stays fully collateralised, so proceeds
 *    exceed the split cost. Unsold YES merges back with NO to USDC.
 *  - below the band: buy YES at ≤ ~0.02, then merge it with whatever NO
 *    inventory earlier splits left behind.
 *
 * Same contract as `createMarketsOnChain`: simulate-first, per-market
 * failure isolation, idempotent by on-chain state (an in-band pool costs
 * only reads). Spend is capped by the signer's live USDC balance and a
 * per-market ceiling.
 */
export async function rebandOpenMarkets(
  candidates: readonly ReclaimCandidate[],
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<RebandSummary | null> {
  const wallet = marketSignerWallet(chainId);
  if (!wallet) return null;
  const cfg = marketsCfg(chainId);
  const client = getRpcClient(chainId);
  const signer = wallet.account.address;

  const summary: RebandSummary = {
    scanned: 0,
    soldDown: 0,
    boughtUp: 0,
    merged: 0,
    skippedInBand: 0,
    skippedNoBudget: 0,
    failures: [],
  };

  const approveThenWait = async (token: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: token,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, amount],
    });
    await writeAndWait(wallet, request, chainId);
  };
  const balanceOf = (token: `0x${string}`) =>
    client.readContract({
      address: token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [signer],
    });

  for (const m of candidates) {
    summary.scanned += 1;
    try {
      const market = await client.readContract({
        address: cfg.markets.factory,
        abi: MARKET_FACTORY_ABI,
        functionName: "marketOf",
        args: [m.marketId as `0x${string}`],
      });
      if (market === "0x0000000000000000000000000000000000000000") continue;
      const state = await client.readContract({
        address: market,
        abi: MARKET_ABI,
        functionName: "state",
      });
      if (state !== 0) continue; // only OPEN books trade — nothing to re-band

      const yesToken = (m.yesToken ??
        (await client.readContract({
          address: market,
          abi: MARKET_ABI,
          functionName: "yesToken",
        }))) as `0x${string}`;
      const plan = planMarketPool(yesToken, cfg.markets.collateral, cfg.dm.hook, 0.5);
      const [sqrtPriceX96] = await client.readContract({
        address: cfg.periphery.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [plan.poolId],
      });
      const liquidity = await client.readContract({
        address: cfg.periphery.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getLiquidity",
        args: [plan.poolId],
      });
      const swap = planRebandSwap({ sqrtPriceX96, liquidity, yesIsToken0: plan.yesIsToken0 });
      if (!swap) {
        summary.skippedInBand += 1;
        continue;
      }

      const usdcBalance = await balanceOf(cfg.markets.collateral);
      const cap =
        swap.maxInput < REBAND_MAX_INPUT_PER_MARKET ? swap.maxInput : REBAND_MAX_INPUT_PER_MARKET;
      const amountIn = cap < usdcBalance ? cap : usdcBalance;
      if (amountIn === 0n) {
        summary.skippedNoBudget += 1;
        continue;
      }

      if (swap.inputIsYes) {
        // Sell leg: split USDC into amountIn YES + NO, then sell the YES.
        await approveThenWait(cfg.markets.collateral, market, amountIn);
        const { request: splitReq } = await client.simulateContract({
          account: wallet.account,
          address: market,
          abi: MARKET_SPLIT_ABI,
          functionName: "split",
          args: [amountIn],
        });
        await writeAndWait(wallet, splitReq, chainId);
        await approveThenWait(yesToken, cfg.periphery.poolSwapTest, amountIn);
      } else {
        // Buy leg: spend USDC directly.
        await approveThenWait(cfg.markets.collateral, cfg.periphery.poolSwapTest, amountIn);
      }

      // Exact-input swap with the limit at the target: the pool walks to
      // the band edge and stops; surplus input simply goes unspent.
      const { request: swapReq } = await client.simulateContract({
        account: wallet.account,
        address: cfg.periphery.poolSwapTest,
        abi: POOL_SWAP_TEST_ABI,
        functionName: "swap",
        args: [
          plan.key,
          {
            zeroForOne: swap.zeroForOne,
            amountSpecified: -amountIn,
            sqrtPriceLimitX96: swap.sqrtPriceLimitX96,
          },
          { takeClaims: false, settleUsingBurn: false },
          "0x",
        ],
      });
      await writeAndWait(wallet, swapReq, chainId);
      if (swap.inputIsYes) summary.soldDown += 1;
      else summary.boughtUp += 1;

      // Merge whatever full YES+NO sets the signer now holds back to USDC:
      // unsold split surplus on the sell leg, bought YES against prior NO
      // inventory on the buy leg. No approval — merge burns directly.
      const noToken = (m.noToken ??
        (await client.readContract({
          address: market,
          abi: MARKET_ABI,
          functionName: "noToken",
        }))) as `0x${string}`;
      const [yesBal, noBal] = await Promise.all([balanceOf(yesToken), balanceOf(noToken)]);
      const mergeable = yesBal < noBal ? yesBal : noBal;
      if (mergeable > 0n) {
        const { request: mergeReq } = await client.simulateContract({
          account: wallet.account,
          address: market,
          abi: MARKET_SPLIT_ABI,
          functionName: "merge",
          args: [mergeable],
        });
        await writeAndWait(wallet, mergeReq, chainId);
        summary.merged += 1;
      }
      logger.info(
        {
          chainId,
          marketId: m.marketId,
          action: swap.action,
          amountIn: amountIn.toString(),
          merged: mergeable.toString(),
        },
        "markets: re-banded out-of-band pool",
      );
    } catch (err) {
      summary.failures.push({
        marketId: m.marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

// ─── P-006: automatic position settlement (post-resolution sweep) ────────

/** A position row as the settlement planner sees it (store supplies rows). */
export interface SettleablePositionRow {
  id: string;
  marketId: string;
  walletAddress: string;
  /** yes | no */
  side: string;
  /** The market's DB state: RESOLVED | SETTLED | INVALID (pre-filtered). */
  state: string;
  redeemedAt: Date | null;
}

export interface PositionSettlementPlan {
  /** Rows to stamp settled, with the per-token settlement value. */
  marks: { id: string; marketId: string; settlementPrice: string }[];
  /** Distinct (market, wallet) pairs holding claimable value and not yet
   *  redeemed — the auto-redeem leg's candidates. */
  redeemCandidates: { marketId: string; walletAddress: string }[];
  /** RESOLVED rows whose winner the resolutions log doesn't know yet —
   *  held for a later tick, never guessed. */
  heldUnknownWinner: number;
}

/**
 * Decide the settlement writes for one pass, pure: each unsettled position
 * on a finished market settles at $1/$0 per side ($0.50 on INVALID) per
 * `settlementPriceFor`; positions whose settled value is positive and that
 * were never redeemed become auto-redeem candidates. A market whose winner
 * is unknown holds — the asymmetry doctrine again (a wrong settlement
 * price in the mirror misreports P/L; a late one is just late).
 */
export function planPositionSettlement(
  rows: readonly SettleablePositionRow[],
  winnerByMarket: ReadonlyMap<string, number>,
): PositionSettlementPlan {
  const plan: PositionSettlementPlan = { marks: [], redeemCandidates: [], heldUnknownWinner: 0 };
  const candidateKeys = new Set<string>();
  for (const row of rows) {
    if (row.side !== "yes" && row.side !== "no") continue;
    const price = settlementPriceFor(
      row.side,
      row.state,
      winnerByMarket.get(row.marketId) ?? null,
    );
    if (price === null) {
      plan.heldUnknownWinner += 1;
      continue;
    }
    plan.marks.push({ id: row.id, marketId: row.marketId, settlementPrice: price });
    if (Number(price) > 0 && row.redeemedAt === null) {
      const key = `${row.marketId}:${row.walletAddress}`;
      if (!candidateKeys.has(key)) {
        candidateKeys.add(key);
        plan.redeemCandidates.push({ marketId: row.marketId, walletAddress: row.walletAddress });
      }
    }
  }
  return plan;
}

export interface AgentRedeemSummary {
  attempted: number;
  redeemed: number;
  skippedNoBalance: number;
  skippedNotRedeemable: number;
  failures: { marketId: string; error: string }[];
}

export interface SettlementSummary {
  scanned: number;
  positionsSettled: number;
  heldUnknownWinner: number;
  /** Circle auto-redeem leg, or a string explaining why it didn't run. */
  agentRedeems: AgentRedeemSummary | string;
}

/** Injectable seam for tests: the Circle redemption executor. */
export interface SettlementDeps {
  executeRedeem?: (args: {
    walletId: string;
    to: `0x${string}`;
    callData: `0x${string}`;
  }) => Promise<{ txHash: `0x${string}` }>;
}

/**
 * The post-resolution settlement pass (P-006), extending the reclaim sweep
 * pattern: after a market resolves,
 *
 *  (a) every unsettled `market_positions` row on it is stamped
 *      `settledAt`/`settlementPrice` ($1 winning side, $0 losing, $0.50
 *      INVALID) so portfolio P/L can realize without waiting for a claim;
 *  (b) positions held by AGENT wallets (Circle DCW — server-controlled)
 *      auto-redeem through the existing redeem machinery: the market's
 *      LIVE on-chain state picks redeem vs redeemInvalid (exactly like the
 *      user route), the market address is admitted to the Circle target
 *      allowlist from OUR factory read, and the confirmed receipt stamps
 *      `redeemedAt`/`redeemTxHash` plus a `market_redeem` audit row.
 *      Redemption is an inflow, so no spending cap is involved — the same
 *      posture as the user redeem route;
 *  (c) user-custody positions cannot be force-redeemed (the user must
 *      sign) — they stay `settledAt` set + `redeemedAt` null, which is
 *      precisely what the redeemable API surfaces as claimable. No
 *      double-count: realized P/L reads settlement fields, claims read
 *      redemption fields.
 *
 * Idempotent: settled rows (settledAt NOT null) never re-enter, the redeem
 * leg is gated on live token balances (a redeemed wallet reads zero), and
 * every leg isolates per-item failures.
 */
export async function settleResolvedPositions(
  db: DB,
  chainId: SupportedChainId = BASE_CHAIN_ID,
  deps: SettlementDeps = {},
): Promise<SettlementSummary> {
  const rows = await db
    .select({
      id: marketPositions.id,
      marketId: marketPositions.marketId,
      walletAddress: marketPositions.walletAddress,
      side: marketPositions.side,
      redeemedAt: marketPositions.redeemedAt,
      state: marketsSchema.state,
      yesToken: marketsSchema.yesToken,
      noToken: marketsSchema.noToken,
    })
    .from(marketPositions)
    .innerJoin(marketsSchema, eq(marketPositions.marketId, marketsSchema.marketId))
    .where(
      and(
        eq(marketsSchema.chainId, chainId),
        inArray(marketsSchema.state, ["RESOLVED", "SETTLED", "INVALID"]),
        isNull(marketPositions.settledAt),
      ),
    );

  const summary: SettlementSummary = {
    scanned: rows.length,
    positionsSettled: 0,
    heldUnknownWinner: 0,
    agentRedeems: "nothing to redeem",
  };
  if (rows.length === 0) return summary;

  // Winner per market (market vocabulary: 0 = YES pays) from the
  // resolutions log; later rows win so overrides supersede.
  const marketIds = [...new Set(rows.map((r) => r.marketId))];
  const winnerByMarket = new Map<string, number>();
  const resRows = await db
    .select({
      marketId: resolutions.marketId,
      winningOutcomeIndex: resolutions.winningOutcomeIndex,
    })
    .from(resolutions)
    .where(inArray(resolutions.marketId, marketIds))
    .orderBy(asc(resolutions.createdAt));
  for (const r of resRows) {
    if (r.winningOutcomeIndex !== null) winnerByMarket.set(r.marketId, r.winningOutcomeIndex);
  }

  const plan = planPositionSettlement(rows, winnerByMarket);
  summary.heldUnknownWinner = plan.heldUnknownWinner;

  const now = new Date();
  for (const mark of plan.marks) {
    await db
      .update(marketPositions)
      .set({ settledAt: now, settlementPrice: mark.settlementPrice, updatedAt: now })
      .where(and(eq(marketPositions.id, mark.id), isNull(marketPositions.settledAt)));
    summary.positionsSettled += 1;
  }

  if (plan.redeemCandidates.length === 0) return summary;

  // (b) — the agent auto-redeem leg. Wallets in `agent_wallets` are Circle
  // DCW (server-controlled); anything else is user custody and stays (c).
  const wallets = [...new Set(plan.redeemCandidates.map((c) => c.walletAddress))];
  const agentRows = await db
    .select({ address: agentWallets.address, circleWalletId: agentWallets.circleWalletId })
    .from(agentWallets)
    .where(inArray(agentWallets.address, wallets));
  const agentByAddress = new Map(agentRows.map((w) => [w.address.toLowerCase(), w]));
  const agentCandidates = plan.redeemCandidates.filter((c) =>
    agentByAddress.has(c.walletAddress.toLowerCase()),
  );
  if (agentCandidates.length === 0) return summary;

  let cfg: ReturnType<typeof marketsCfg>;
  try {
    cfg = marketsCfg(chainId);
  } catch {
    summary.agentRedeems = "disabled (markets not deployed on this chain)";
    return summary;
  }
  const client = getRpcClient(chainId);
  const tokensByMarket = new Map(
    rows.map((r) => [r.marketId, { yesToken: r.yesToken, noToken: r.noToken }]),
  );
  const executeRedeem =
    deps.executeRedeem ??
    (async (args: { walletId: string; to: `0x${string}`; callData: `0x${string}` }) => {
      const result = await executeAgentCalldata(args);
      return { txHash: result.txHash };
    });

  const redeems: AgentRedeemSummary = {
    attempted: 0,
    redeemed: 0,
    skippedNoBalance: 0,
    skippedNotRedeemable: 0,
    failures: [],
  };
  summary.agentRedeems = redeems;

  for (const candidate of agentCandidates) {
    const wallet = agentByAddress.get(candidate.walletAddress.toLowerCase());
    const tokens = tokensByMarket.get(candidate.marketId);
    if (!wallet || !tokens?.yesToken || !tokens.noToken) continue;
    redeems.attempted += 1;
    try {
      const market = await client.readContract({
        address: cfg.markets.factory,
        abi: MARKET_FACTORY_ABI,
        functionName: "marketOf",
        args: [candidate.marketId as `0x${string}`],
      });
      if (market === "0x0000000000000000000000000000000000000000") continue;
      // The LIVE on-chain state picks the function — the DB row can lead
      // the chain briefly right after a resolve tx; wait for the chain.
      const state = await client.readContract({
        address: market,
        abi: MARKET_ABI,
        functionName: "state",
      });
      const fn = redeemFunctionForOnchainState(state);
      if (fn === null) {
        redeems.skippedNotRedeemable += 1;
        continue;
      }
      const [yesBal, noBal] = await Promise.all(
        [tokens.yesToken, tokens.noToken].map((t) =>
          client.readContract({
            address: t as `0x${string}`,
            abi: ERC20_BALANCE_OF_ABI,
            functionName: "balanceOf",
            args: [wallet.address as `0x${string}`],
          }),
        ),
      );
      if (yesBal === 0n && noBal === 0n) {
        // Already redeemed on-chain (or never held) — stamp the mirror so
        // the pass converges instead of retrying forever.
        redeems.skippedNoBalance += 1;
        await db
          .update(marketPositions)
          .set({ redeemedAt: now, updatedAt: now })
          .where(
            and(
              eq(marketPositions.marketId, candidate.marketId),
              eq(marketPositions.walletAddress, candidate.walletAddress),
              isNull(marketPositions.redeemedAt),
            ),
          );
        continue;
      }
      // Server-trusted read → allowlist admission (the agent-trade pattern).
      registerDynamicTargets([market]);
      const { txHash } = await executeRedeem({
        walletId: wallet.circleWalletId,
        to: market,
        callData: redeemCalldata(fn),
      });
      await db
        .update(marketPositions)
        .set({ redeemedAt: now, redeemTxHash: txHash.toLowerCase(), updatedAt: now })
        .where(
          and(
            eq(marketPositions.marketId, candidate.marketId),
            eq(marketPositions.walletAddress, candidate.walletAddress),
            isNull(marketPositions.redeemedAt),
          ),
        );
      await logAudit({
        walletAddress: candidate.walletAddress,
        action: "market_redeem",
        outcome: "success",
        txHash: txHash.toLowerCase(),
        chainId,
        params: { marketId: candidate.marketId, automated: true, trigger: "settlement-sweep" },
      });
      redeems.redeemed += 1;
    } catch (err) {
      redeems.failures.push({
        marketId: candidate.marketId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (redeems.redeemed > 0) {
    logger.info({ chainId, ...redeems }, "markets: auto-redeemed agent positions");
  }
  return summary;
}

export async function filterPlanToExistingMarkets(
  plan: ResolutionPlan,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<ResolutionPlan> {
  const ids = [...new Set([...plan.freezes, ...plan.submissions.map((s) => s.marketId)])];
  if (ids.length === 0) return plan;
  const cfg = marketsCfg(chainId);
  const client = getRpcClient(chainId);

  const exists = new Map<string, boolean>();
  await Promise.all(
    ids.map(async (id) => {
      const addr = await client.readContract({
        address: cfg.markets.factory,
        abi: MARKET_FACTORY_ABI,
        functionName: "marketOf",
        args: [id],
      });
      exists.set(id, addr !== "0x0000000000000000000000000000000000000000");
    }),
  );

  return {
    freezes: plan.freezes.filter((id) => exists.get(id)),
    submissions: plan.submissions.filter((s) => exists.get(s.marketId)),
    held: plan.held,
    assessments: plan.assessments,
  };
}
