import { and, eq } from "drizzle-orm";
import { type Address, encodeFunctionData, parseAbi, parseUnits } from "viem";
import { db } from "../db/client.ts";
import { pools, portfolioTransactions, positions } from "../db/schema/trading.ts";
import { users } from "../db/schema/users.ts";
import { explorerTxUrl } from "./agent-send.ts";
import { AgentWalletNotFoundError, getAgentWallet } from "./agent-wallet.ts";
import { executeAgentAbiCall, executeAgentCalldata } from "./circle/execute.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { buildPoolKey } from "./pool-key.ts";
import { getRpcClient } from "./rpc-client.ts";
import { checkSpendingCap, recordSpending } from "./spending-cap.ts";
import { getToken, getTokens, type TokenSymbol, ZERO_ADDRESS } from "./tokens.ts";
import { getUsdPrice, tokenAmountUsdStrict } from "./usd-pricing.ts";
import { encodeSqrtPriceX96 } from "./sqrt-price.ts";
import { buildAddLiquidityCalldata } from "./v4-add-liquidity.ts";
import {
  getHookAddress,
  getV4StackForHook,
  PERMIT2,
  POOL_MANAGER_INITIALIZE_ABI,
  type FeeTier,
  type HookName,
} from "./v4-contracts.ts";
import { buildRemoveLiquidityCalldata } from "./v4-remove-liquidity.ts";
import { readSlot0 } from "./v4-state-view.ts";

const AGENT_NETWORK = "base" as const;
/**
 * Bounded-approval policy (D-110): every grant is sized to the current trade
 * and short-lived — never a max allowance, never a far-future expiry.
 */
const PERMIT2_ALLOWANCE_EXPIRATION_SECONDS = 3600;
/** Re-grant when an existing Permit2 allowance expires within this window. */
const PERMIT2_VALIDITY_BUFFER_SECONDS = 600;

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const PERMIT2_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
    ],
    outputs: [
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
      { type: "uint48", name: "nonce" },
    ],
  },
] as const;

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = `0x${"0".repeat(64)}` as const;

interface MintedReceiptLog {
  address: string;
  topics: readonly string[];
}

/** Find the PositionManager `Transfer(0x0, owner, tokenId)` mint log. */
function extractMintedTokenId(
  logs: readonly MintedReceiptLog[],
  owner: string,
  positionManager: string,
): string | null {
  const ownerTopic = `0x${"0".repeat(24)}${owner.slice(2).toLowerCase()}`;
  const pm = positionManager.toLowerCase();
  for (const l of logs) {
    if (l.address.toLowerCase() !== pm) continue;
    if (l.topics[0] !== TRANSFER_TOPIC) continue;
    if (l.topics[1]?.toLowerCase() !== ZERO_TOPIC) continue;
    if (l.topics[2]?.toLowerCase() !== ownerTopic) continue;
    const idTopic = l.topics[3];
    if (!idTopic) return null;
    return BigInt(idTopic).toString();
  }
  return null;
}

export interface MintAllowanceState {
  /** Current ERC20 allowance from the owner to the Permit2 contract. */
  erc20Allowance: bigint;
  /** Current Permit2 allowance amount (uint160) from the owner to the spender. */
  permit2Allowance: bigint;
  /** Unix-seconds expiry of the Permit2 allowance. */
  permit2Expiration: number;
}

/** One approval to execute from the agent wallet, in `executeAgentAbiCall` shape. */
export interface PlannedMintApproval {
  to: Address;
  abiFunctionSignature: string;
  abiParameters: string[];
}

/**
 * Bounded-approval decision for one token (D-110): which approvals a mint
 * needs so allowances never exceed what the current trade can pull. The mint
 * pulls at most `requiredRaw` (the max amount incl. slippage buffer), so each
 * grant is exactly that — never a max allowance. Allowances that already
 * cover the mint are reused; expired / soon-to-expire Permit2 grants are
 * re-issued with a bounded one-hour expiry. Pure so it stays unit-testable.
 */
export function planMintApprovals(params: {
  token: Address;
  positionManager: Address;
  /** Raw max amount this mint can pull for this token (incl. slippage buffer). */
  requiredRaw: bigint;
  state: MintAllowanceState;
  /** Unix seconds now — injected so the decision is pure and testable. */
  nowSeconds: number;
}): PlannedMintApproval[] {
  const { token, positionManager, requiredRaw, state, nowSeconds } = params;
  const calls: PlannedMintApproval[] = [];

  if (state.erc20Allowance < requiredRaw) {
    calls.push({
      to: token,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [PERMIT2, requiredRaw.toString()],
    });
  }

  const expiredSoon = state.permit2Expiration <= nowSeconds + PERMIT2_VALIDITY_BUFFER_SECONDS;
  if (state.permit2Allowance < requiredRaw || expiredSoon) {
    calls.push({
      to: PERMIT2,
      abiFunctionSignature: "approve(address,address,uint160,uint48)",
      abiParameters: [
        token,
        positionManager,
        requiredRaw.toString(),
        (nowSeconds + PERMIT2_ALLOWANCE_EXPIRATION_SECONDS).toString(),
      ],
    });
  }

  return calls;
}

/**
 * On-chain approvals so the agent's Circle wallet can mint without a per-tx
 * Permit2 signature (which developer-controlled wallets can't sign inline):
 * ERC20→Permit2 and Permit2→PositionManager allowances, bounded to exactly
 * this trade's max pull — see planMintApprovals. Idempotent: allowances that
 * already cover the mint are reused. No-op for native (zero address).
 */
async function ensureMintApprovals(
  walletId: string,
  owner: Address,
  token: Address,
  positionManager: Address,
  requiredRaw: bigint,
  chainId: SupportedChainId,
): Promise<void> {
  if (token === ZERO_ADDRESS) return;

  const rpc = getRpcClient(chainId);
  const erc20Allowance = await rpc.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, PERMIT2],
  });
  const [permit2Amount, permit2Expiration] = await rpc.readContract({
    address: PERMIT2,
    abi: PERMIT2_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [owner, token, positionManager],
  });

  const calls = planMintApprovals({
    token,
    positionManager,
    requiredRaw,
    state: { erc20Allowance, permit2Allowance: permit2Amount, permit2Expiration },
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  for (const call of calls) {
    await executeAgentAbiCall({ walletId, ...call });
  }
}

export interface AgentAddLiquidityArgs {
  privyUserId: string;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  /** Optional hook bound to the pool. Omit / null for a no-hook pool. */
  hook?: HookName | null;
  amountA: string;
  amountB: string;
  slippageBps: number;
  deadlineSeconds: number;
  /** Execution chain — defaults to Base. */
  chainId?: SupportedChainId;
}

export interface AgentAddLiquidityResult {
  txHash: `0x${string}`;
  explorerUrl: string;
  agentAddress: string;
  tokenId: string | null;
  liquidity: string;
  poolKeyHash: `0x${string}`;
  amountARaw: string;
  amountBRaw: string;
  usdValue: number;
  network: typeof AGENT_NETWORK;
}

/**
 * Add liquidity from the agent's Circle wallet on Base (with or without a hook).
 *
 *   1. Lookup wallet, parseUnits, USD-value cap check.
 *   2. Read sqrtPriceX96 (pool must already be initialized).
 *   3. Build the v4 mint calldata.
 *   4. Bounded Permit2 approvals (ERC20→Permit2, Permit2→PositionManager) for
 *      each pool token, sized to the mint's max pull for that token, so the
 *      mint needs no per-tx signature.
 *   5. Execute the modifyLiquidities calldata via the Circle wallet.
 *   6. Fetch the receipt from Base, extract the minted tokenId.
 *   7. recordSpending + persist the position (mirrors the user add-record path).
 */
export async function addLiquidityFromAgentWallet(
  args: AgentAddLiquidityArgs,
): Promise<AgentAddLiquidityResult> {
  const { privyUserId, tokenA, tokenB, fee, amountA, amountB, slippageBps, deadlineSeconds } = args;
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const hook = args.hook ?? null;
  if (tokenA === tokenB) throw new Error("tokenA and tokenB must differ");

  const wallet = await getAgentWallet(privyUserId, chainId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);

  const tA = getToken(tokenA, chainId);
  const tB = getToken(tokenB, chainId);
  const amountARaw = parseUnits(amountA, tA.decimals);
  const amountBRaw = parseUnits(amountB, tB.decimals);
  if (amountARaw <= 0n || amountBRaw <= 0n) throw new Error("Both amounts must be positive");

  // C-019 — strict pricing: a dead feed throws instead of valuing the spend
  // at $0, so the cap cannot be priced around.
  const usdValue =
    (await tokenAmountUsdStrict(tokenA, amountARaw)) +
    (await tokenAmountUsdStrict(tokenB, amountBRaw));
  await checkSpendingCap(wallet.address, usdValue);

  const hookAddress = hook ? (getHookAddress(hook, chainId) ?? ZERO_ADDRESS) : ZERO_ADDRESS;
  const { key } = buildPoolKey(tokenA, tokenB, fee, hookAddress, hook, chainId);
  const slot0 = await readSlot0(key, chainId);
  if (!slot0) throw new Error("Pool not initialized — create it first");

  const calldata = buildAddLiquidityCalldata({
    chainId,
    tokenA,
    tokenB,
    fee,
    hookAddress,
    hookName: hook,
    amountARaw,
    amountBRaw,
    sqrtPriceX96: slot0.sqrtPriceX96,
    slippageBps,
    owner: wallet.address as Address,
    deadlineSeconds,
  });

  if (calldata.value !== "0") {
    throw new Error("Native-value adds are not supported via the agent wallet yet");
  }

  // calldata.to is the per-hook PositionManager — the Permit2 spender. Approvals
  // are bounded per token to the mint's max pull (amount0Max/1Max include the
  // slippage buffer) — never a max allowance (D-110).
  await ensureMintApprovals(
    wallet.circleWalletId,
    wallet.address as Address,
    calldata.currency0,
    calldata.to,
    BigInt(calldata.amount0Max),
    chainId,
  );
  await ensureMintApprovals(
    wallet.circleWalletId,
    wallet.address as Address,
    calldata.currency1,
    calldata.to,
    BigInt(calldata.amount1Max),
    chainId,
  );

  const { txHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: calldata.to,
    callData: calldata.data,
  });

  const receipt = await getRpcClient(chainId).waitForTransactionReceipt({ hash: txHash });
  const tokenId = extractMintedTokenId(receipt.logs, wallet.address, calldata.to);

  await recordSpending(wallet.address, usdValue);

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const user = userRows.at(0);
  if (user) {
    await db.insert(portfolioTransactions).values({
      userId: user.id,
      walletAddress: wallet.address,
      action: "add_liquidity",
      txHash,
      chainId,
      params: {
        tokenA,
        tokenB,
        fee,
        hook,
        amountARaw: amountARaw.toString(),
        amountBRaw: amountBRaw.toString(),
        liquidity: calldata.liquidity,
        tickLower: calldata.tickLower,
        tickUpper: calldata.tickUpper,
        poolKeyHash: calldata.poolKeyHash,
        agent: true,
      },
      outcome: "success",
      usdValue: usdValue > 0 ? usdValue.toFixed(2) : null,
    });

    const poolRows = await db
      .select({ id: pools.id })
      .from(pools)
      .where(eq(pools.poolKeyHash, calldata.poolKeyHash))
      .limit(1);
    const pool = poolRows.at(0);
    if (pool) {
      await db.insert(positions).values({
        userId: user.id,
        poolId: pool.id,
        ...(tokenId ? { tokenId } : {}),
        tickLower: calldata.tickLower,
        tickUpper: calldata.tickUpper,
        liquidity: calldata.liquidity,
        status: "open",
        openedTx: txHash,
      });
    }
  }

  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash, chainId),
    agentAddress: wallet.address,
    tokenId,
    liquidity: calldata.liquidity,
    poolKeyHash: calldata.poolKeyHash,
    amountARaw: amountARaw.toString(),
    amountBRaw: amountBRaw.toString(),
    usdValue,
    network: AGENT_NETWORK,
  };
}

export interface AgentRemoveLiquidityArgs {
  privyUserId: string;
  /** Internal `positions.id` (uuid). The position must belong to this user. */
  positionId: string;
  /** Percentage 1–100. */
  percentage: number;
  slippageBps: number;
  deadlineSeconds: number;
  /** Execution chain — defaults to Base. */
  chainId?: SupportedChainId;
}

export interface AgentRemoveLiquidityResult {
  txHash: `0x${string}`;
  explorerUrl: string;
  agentAddress: string;
  positionId: string;
  liquidityRemoved: string;
  isFullExit: boolean;
  network: typeof AGENT_NETWORK;
}

export async function removeLiquidityFromAgentWallet(
  args: AgentRemoveLiquidityArgs,
): Promise<AgentRemoveLiquidityResult> {
  const { privyUserId, positionId, percentage, slippageBps, deadlineSeconds } = args;
  const chainId = args.chainId ?? BASE_CHAIN_ID;

  const wallet = await getAgentWallet(privyUserId, chainId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const user = userRows.at(0);
  if (!user) throw new Error("User record missing");

  const posRows = await db
    .select({
      id: positions.id,
      tokenId: positions.tokenId,
      tickLower: positions.tickLower,
      tickUpper: positions.tickUpper,
      liquidity: positions.liquidity,
      status: positions.status,
      token0: pools.token0,
      token1: pools.token1,
      fee: pools.fee,
      tickSpacing: pools.tickSpacing,
      hookAddress: pools.hookAddress,
    })
    .from(positions)
    .innerJoin(pools, eq(positions.poolId, pools.id))
    .where(eq(positions.id, positionId))
    .limit(1);
  const pos = posRows.at(0);
  if (!pos || pos.status !== "open") throw new Error("Position not found or already closed");
  if (!pos.tokenId) throw new Error("Position has no on-chain tokenId");

  const slot0 = await readSlot0(
    {
      currency0: pos.token0 as Address,
      currency1: pos.token1 as Address,
      fee: pos.fee,
      tickSpacing: pos.tickSpacing,
      hooks: (pos.hookAddress ?? ZERO_ADDRESS) as Address,
    },
    chainId,
  );
  if (!slot0) throw new Error("Pool not initialized on-chain");

  const totalLiquidity = BigInt(pos.liquidity);
  const liquidityToRemove = (totalLiquidity * BigInt(percentage)) / 100n;
  const isFullExit = percentage >= 100;

  const calldata = buildRemoveLiquidityCalldata({
    chainId,
    tokenId: BigInt(pos.tokenId),
    liquidityToRemove,
    positionLiquidity: totalLiquidity,
    tickLower: pos.tickLower,
    tickUpper: pos.tickUpper,
    sqrtPriceX96: slot0.sqrtPriceX96,
    currency0: pos.token0 as Address,
    currency1: pos.token1 as Address,
    hookAddress: (pos.hookAddress ?? null) as `0x${string}` | null,
    slippageBps,
    recipient: wallet.address as Address,
    deadlineSeconds,
  });

  // The agent owns the position NFT, so removal needs no Permit2 — just execute
  // the decrease/burn calldata from the Circle wallet.
  const { txHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: calldata.to,
    callData: calldata.data,
  });
  await getRpcClient(chainId).waitForTransactionReceipt({ hash: txHash });

  await db.insert(portfolioTransactions).values({
    userId: user.id,
    walletAddress: wallet.address,
    action: "remove_liquidity",
    txHash,
    chainId,
    params: {
      positionId,
      liquidityRemoved: liquidityToRemove.toString(),
      isFullExit,
      agent: true,
    },
    outcome: "success",
  });

  if (isFullExit) {
    await db
      .update(positions)
      .set({ status: "closed", closedTx: txHash })
      .where(eq(positions.id, positionId));
  } else {
    const remaining = totalLiquidity - liquidityToRemove;
    await db
      .update(positions)
      .set({ liquidity: remaining.toString() })
      .where(eq(positions.id, positionId));
  }

  return {
    txHash,
    explorerUrl: explorerTxUrl(txHash, chainId),
    agentAddress: wallet.address,
    positionId,
    liquidityRemoved: liquidityToRemove.toString(),
    isFullExit,
    network: AGENT_NETWORK,
  };
}

export interface AgentPositionSummary {
  /** Internal DB id — pass this as `positionId` to remove. */
  id: string;
  tokenId: string | null;
  tokenA: string;
  tokenB: string;
  fee: number;
  /** Agent only opens no-hook pools; true for legacy hooked positions. */
  hasHook: boolean;
  liquidity: string;
}

/**
 * The agent's open LP positions (from the DB `positions` table), for the
 * `get_positions` chat tool and the remove-by-id flow. Token addresses are
 * mapped back to registry symbols where known.
 */
export async function listAgentPositions(
  privyUserId: string,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<AgentPositionSummary[]> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const user = userRows.at(0);
  if (!user) return [];

  const rows = await db
    .select({
      id: positions.id,
      tokenId: positions.tokenId,
      liquidity: positions.liquidity,
      token0: pools.token0,
      token1: pools.token1,
      fee: pools.fee,
      hookAddress: pools.hookAddress,
    })
    .from(positions)
    .innerJoin(pools, eq(positions.poolId, pools.id))
    .where(and(eq(positions.userId, user.id), eq(positions.status, "open")));

  const tokens = getTokens(chainId);
  const byAddr = new Map<string, string>();
  for (const sym of Object.keys(tokens)) byAddr.set(tokens[sym].address.toLowerCase(), sym);

  return rows.map((r) => ({
    id: r.id,
    tokenId: r.tokenId,
    tokenA: byAddr.get(r.token0.toLowerCase()) ?? r.token0,
    tokenB: byAddr.get(r.token1.toLowerCase()) ?? r.token1,
    fee: r.fee,
    hasHook: !!r.hookAddress && r.hookAddress.toLowerCase() !== ZERO_ADDRESS.toLowerCase(),
    liquidity: r.liquidity,
  }));
}

// ─── Agent pool creation (no-hook only) ─────────────────────────────────────

export interface AgentCreatePoolArgs {
  privyUserId: string;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  /** Execution chain — defaults to Base. */
  chainId?: SupportedChainId;
}

export interface AgentCreatePoolResult {
  alreadyExists: boolean;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  txHash?: `0x${string}`;
  explorerUrl?: string;
}

/**
 * Initialize a NO-HOOK v4 pool from the agent wallet. The init price comes from
 * the live Pyth/DefiLlama USD ratio (market-fair, matching the user route's
 * policy in routes/pool-create.ts) so the pool opens at the real rate. If the
 * pool is already initialized, returns `{ alreadyExists: true }` so the agent
 * can proceed straight to add_liquidity.
 */
export async function createPoolFromAgentWallet(
  args: AgentCreatePoolArgs,
): Promise<AgentCreatePoolResult> {
  const chainId = args.chainId ?? BASE_CHAIN_ID;
  const wallet = await getAgentWallet(args.privyUserId, chainId);
  if (!wallet) throw new AgentWalletNotFoundError(args.privyUserId);
  if (args.tokenA === args.tokenB) throw new Error("tokenA and tokenB must differ.");

  const { key, flipped } = buildPoolKey(
    args.tokenA,
    args.tokenB,
    args.fee,
    ZERO_ADDRESS,
    null,
    chainId,
  );

  const existing = await readSlot0(key, chainId);
  if (existing) {
    return { alreadyExists: true, tokenA: args.tokenA, tokenB: args.tokenB, fee: args.fee };
  }

  // Market-fair init price from live USD prices: in raw base units,
  // amount1/amount0 = (pA/pB) · 10^dB / 10^dA for the (A, B) ordering, then
  // swapped when the canonical currency order flips the pair.
  const [pA, pB] = await Promise.all([getUsdPrice(args.tokenA), getUsdPrice(args.tokenB)]);
  if (!pA || !pB) throw new Error("Live USD prices unavailable — cannot derive an init price.");
  const SCALE = 1_000_000;
  const tokA = getToken(args.tokenA, chainId);
  const tokB = getToken(args.tokenB, chainId);
  const rawA = 10n ** BigInt(tokA.decimals) * BigInt(Math.round(pB * SCALE));
  const rawB = 10n ** BigInt(tokB.decimals) * BigInt(Math.round(pA * SCALE));
  const sqrtPriceX96 = encodeSqrtPriceX96(
    flipped ? { amount0Raw: rawB, amount1Raw: rawA } : { amount0Raw: rawA, amount1Raw: rawB },
  );

  const callData = encodeFunctionData({
    abi: POOL_MANAGER_INITIALIZE_ABI,
    functionName: "initialize",
    args: [key, sqrtPriceX96],
  });
  const { txHash } = await executeAgentCalldata({
    walletId: wallet.circleWalletId,
    to: getV4StackForHook(key.hooks, chainId).poolManager,
    callData,
  });

  return {
    alreadyExists: false,
    tokenA: args.tokenA,
    tokenB: args.tokenB,
    fee: args.fee,
    txHash,
    explorerUrl: explorerTxUrl(txHash, chainId),
  };
}
