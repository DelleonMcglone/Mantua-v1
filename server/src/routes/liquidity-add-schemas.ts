import { z } from "zod";
import { DEFAULT_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { isAnyChainTokenSymbol } from "../lib/tokens.ts";
import { HOOK_NAMES, isFeeTier } from "../lib/v4-contracts.ts";

const hookSchema = z.enum(HOOK_NAMES);

const chainIdSchema = z
  .number()
  .int()
  .refine(isSupportedChainId, "Unsupported chainId")
  .default(DEFAULT_CHAIN_ID);

// Narrows to `TokenSymbol` (per-chain validity is still enforced by the
// route's getToken call). Replaces bare z.string() so downstream calls
// that expect TokenSymbol type-check.
const tokenSymbolSchema = z.string().refine(isAnyChainTokenSymbol, "Unknown token symbol");

export const calldataSchema = z.object({
  chainId: chainIdSchema,
  tokenA: tokenSymbolSchema,
  tokenB: tokenSymbolSchema,
  fee: z.number().int().refine(isFeeTier, "Fee tier must be 100/500/3000/10000"),
  /** Optional hook binding — must match the hook the pool was created
   *  with so the reconstructed PoolKey matches on-chain (hooks like
   *  Stable Protection set `key.fee = DYNAMIC_FEE_FLAG`, which the
   *  client doesn't see). Omitted/null = no-hook pool. */
  hook: hookSchema.nullable().optional(),
  amountARaw: z.string().regex(/^\d+$/),
  amountBRaw: z.string().regex(/^\d+$/),
  /** Optional. When omitted, the server reads slot0 via StateView. The
   *  pool-create flow passes the freshly-initialized price here to
   *  avoid a redundant RPC round-trip. */
  sqrtPriceX96: z.string().regex(/^\d+$/).optional(),
  slippageBps: z.number().int().min(0).max(500).default(50),
  deadlineSeconds: z.number().int().positive(),
});

export const recordSchema = z.object({
  chainId: chainIdSchema,
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  tokenA: tokenSymbolSchema,
  tokenB: tokenSymbolSchema,
  fee: z.number().int().refine(isFeeTier),
  hook: hookSchema.nullable().optional(),
  amountARaw: z.string().regex(/^\d+$/),
  amountBRaw: z.string().regex(/^\d+$/),
  liquidity: z.string().regex(/^\d+$/),
  tickLower: z.number().int(),
  tickUpper: z.number().int(),
  poolKeyHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  /** PositionManager NFT token id minted on success — extracted from
   *  Transfer event in the receipt. Null when outcome=failure. */
  tokenId: z.string().regex(/^\d+$/).nullable().optional(),
  /** Snapshot of the pool's sqrtPriceX96 at mint — used as the price
   *  reference for the remove preview until subgraph indexing lands. */
  sqrtPriceX96: z.string().regex(/^\d+$/).optional(),
  outcome: z.enum(["success", "failure"]),
});
