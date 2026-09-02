import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import {
  DEFAULT_CHAIN_ID,
  isSupportedChainId,
  type SupportedChainId,
} from "../lib/chains.ts";
import { isTokenSymbol } from "../lib/tokens.ts";
import {
  buildPoolSwapTestCalldata,
  decodeSwapRevertReason,
  findMaxQuotableInputV4,
  quoteExactInputV4,
} from "../lib/v4-onchain-swap.ts";
import { HOOK_NAMES, isFeeTier } from "../lib/v4-contracts.ts";
import { HookPairNotAllowedError } from "../lib/hook-pair-gating.ts";
import { isTransientRpcError } from "../lib/rpc-client.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export const v4SwapRouter = Router();

/**
 * Demo mode — when true, swap routes ignore the `hook` field on the
 * request body and always build the on-chain PoolKey with `hooks=0x0`.
 * This routes quotes / calldata to the no-hook variant of the pool so
 * the Stable Protection / Dynamic Fee hooks can't revert. The UI still
 * surfaces the user's hook selection visually; only the on-chain query
 * is detoured.
 *
 * DISABLED: the detour forces `hook = null` for EVERY swap, so
 * hook-bound pools resolve to a zero-hook PoolKey that was never
 * initialized — making every hook swap fail with "No pool is
 * initialized for this pair at this fee tier and hook." Deployed hooks
 * quote correctly through V4Quoter.
 *
 * With the flag off, the user's hook selection passes through verbatim:
 *   - a hook ("stable-protection" / "dynamic-fee" / "rwa-gate" / "alo")
 *     → that hook's gated pool (pair-allowlisted per hook-pair-gating).
 *   - "No Hook" (hook = null) → the plain zero-hook pool on the hero
 *     PoolManager stack, allowed for ANY pair (USDC/EURC/cbBTC in any
 *     combination) — no pair gating applies when there's no hook.
 * Both kinds require the pool to be initialized on-chain first (create
 * it via Add Liquidity with the matching hook/No-Hook + fee tier).
 */
const BYPASS_HOOK_FOR_DEMO = false;

const hookSchema = z.enum(HOOK_NAMES);
const chainIdSchema = z
  .number()
  .int()
  .refine(isSupportedChainId, "Unsupported chainId")
  .optional()
  .transform((v): SupportedChainId => v ?? DEFAULT_CHAIN_ID);

const baseSwapSchema = z.object({
  tokenIn: z.string().refine(isTokenSymbol, "Unknown tokenIn"),
  tokenOut: z.string().refine(isTokenSymbol, "Unknown tokenOut"),
  fee: z.number().int().refine(isFeeTier, "Fee tier must be 100/500/3000/10000"),
  hook: hookSchema.nullable().optional(),
  amountInRaw: z.string().regex(/^\d+$/, "amountInRaw must be a uint string"),
  chainId: chainIdSchema,
});

/**
 * On-chain swap quote — calls v4-periphery's V4Quoter directly via
 * `eth_call` so hook-bound Mantua pools (which Uniswap's Trading API
 * doesn't index) still show a real expected output amount.
 *
 * Aggregator-routed swaps keep using the existing `/api/quote`
 * endpoint; this is a parallel path so that flow stays untouched.
 */
v4SwapRouter.post(
  "/api/v4/quote",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = baseSwapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const { tokenIn, tokenOut, fee, hook, amountInRaw, chainId } = parsed.data;
    if (tokenIn === tokenOut) {
      res.status(400).json({ error: "tokenIn and tokenOut must differ", code: "BAD_REQUEST" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BYPASS_HOOK_FOR_DEMO is a togglable flag
    const effectiveHook = BYPASS_HOOK_FOR_DEMO ? null : (hook ?? null);
    try {
      const quote = await quoteExactInputV4({
        tokenIn,
        tokenOut,
        fee,
        hook: effectiveHook,
        amountInRaw: BigInt(amountInRaw),
        chainId,
      });
      res.json(quote);
    } catch (err) {
      if (err instanceof HookPairNotAllowedError) {
        res.status(400).json({ error: err.message, code: "HOOK_PAIR_NOT_ALLOWED" });
        return;
      }
      logger.warn({ err, tokenIn, tokenOut, hook, chainId }, "v4 onchain quote failed");
      // Surface the specific decoded revert (PoolNotConfigured / NotWhitelisted
      // / NotEnoughLiquidity / …) so the UI stops showing a misleading generic
      // "Quote failed" for what's really an unconfigured/unfunded/gated pool.
      const decodedReason = decodeSwapRevertReason(err);
      const message = decodedReason ?? (err instanceof Error ? err.message : "Quote failed");
      res.status(502).json({ error: message, code: "V4_QUOTE_FAILED" });
    }
  },
);

const maxInputSchema = z.object({
  tokenIn: z.string().refine(isTokenSymbol, "Unknown tokenIn"),
  tokenOut: z.string().refine(isTokenSymbol, "Unknown tokenOut"),
  fee: z.number().int().refine(isFeeTier, "Fee tier must be 100/500/3000/10000"),
  hook: hookSchema.nullable().optional(),
  /** User's wallet balance for `tokenIn`, in raw base units. Search
   *  caps at this value — anything bigger isn't useful since the user
   *  can't spend it anyway. */
  upperBoundRaw: z.string().regex(/^\d+$/, "upperBoundRaw must be a uint string"),
  chainId: chainIdSchema,
});

/**
 * Largest input amount V4Quoter accepts for the given pool key,
 * bounded by the user's wallet balance. Used by the swap panel's
 * percent chips so 25% / 50% / Max can't overshoot pool depth.
 *
 * Binary-searched on-chain — each request fires up to 25 `eth_call`s
 * to V4Quoter, so don't poll this. The client fires it once per pair
 * + fee + hook change.
 */
v4SwapRouter.post(
  "/api/v4/swap/max-input",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = maxInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const { tokenIn, tokenOut, fee, hook, upperBoundRaw, chainId } = parsed.data;
    if (tokenIn === tokenOut) {
      res.status(400).json({ error: "tokenIn and tokenOut must differ", code: "BAD_REQUEST" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BYPASS_HOOK_FOR_DEMO is a togglable flag
    const effectiveHook = BYPASS_HOOK_FOR_DEMO ? null : (hook ?? null);
    try {
      const { maxInput, reason } = await findMaxQuotableInputV4({
        tokenIn,
        tokenOut,
        fee,
        hook: effectiveHook,
        upperBound: BigInt(upperBoundRaw),
        chainId,
      });
      res.json({ maxInputRaw: maxInput.toString(), reason });
    } catch (err) {
      logger.warn({ err, tokenIn, tokenOut, hook, chainId }, "v4 max-input search failed");
      // Transient RPC failures (rate limit / timeout) are not swap
      // rejections — fail open to the uncapped balance instead of
      // surfacing the raw RPC error as a "rejected by hook" banner.
      if (isTransientRpcError(err)) {
        res.json({ maxInputRaw: upperBoundRaw, reason: null });
        return;
      }
      const reason = err instanceof Error ? err.message : null;
      res.json({ maxInputRaw: "0", reason });
    }
  },
);

const calldataSchema = baseSwapSchema.extend({
  /** Slippage tolerance in bps. Used to derive `amountOutMinimum` for
   *  the client to enforce. */
  slippageBps: z.number().int().min(0).max(10_000).default(50),
});

/**
 * Swap calldata — re-runs the quote (so the response
 * carries an `amountOutMinimum` derived from the same on-chain
 * simulation, not stale client state) and returns the
 * `PoolSwapTest.swap` calldata. The client either approves the input
 * ERC-20 to `approvalTarget` first or, for native-ETH input, attaches
 * `value` and skips the approval.
 */
v4SwapRouter.post(
  "/api/v4/swap/calldata",
  writeRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = calldataSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.issues,
      });
      return;
    }
    const { tokenIn, tokenOut, fee, hook, amountInRaw, slippageBps, chainId } = parsed.data;
    if (tokenIn === tokenOut) {
      res.status(400).json({ error: "tokenIn and tokenOut must differ", code: "BAD_REQUEST" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BYPASS_HOOK_FOR_DEMO is a togglable flag
    const effectiveHook = BYPASS_HOOK_FOR_DEMO ? null : (hook ?? null);
    try {
      const quote = await quoteExactInputV4({
        tokenIn,
        tokenOut,
        fee,
        hook: effectiveHook,
        amountInRaw: BigInt(amountInRaw),
        chainId,
      });
      const swap = buildPoolSwapTestCalldata({
        poolKey: quote.poolKey,
        zeroForOne: quote.zeroForOne,
        amountInRaw: BigInt(amountInRaw),
        chainId,
      });
      // amountOutMinimum: amountOut * (1 - slippage)
      const slippageDenom = 10_000n;
      const minOut =
        (BigInt(quote.amountOut) * (slippageDenom - BigInt(slippageBps))) / slippageDenom;
      res.json({
        ...swap,
        quote: {
          amountIn: quote.amountIn,
          amountOut: quote.amountOut,
          amountOutMinimum: minOut.toString(),
          gasEstimate: quote.gasEstimate,
          poolKey: quote.poolKey,
          zeroForOne: quote.zeroForOne,
        },
      });
    } catch (err) {
      if (err instanceof HookPairNotAllowedError) {
        res.status(400).json({ error: err.message, code: "HOOK_PAIR_NOT_ALLOWED" });
        return;
      }
      logger.warn({ err, tokenIn, tokenOut, hook, chainId }, "v4 swap calldata failed");
      const message = err instanceof Error ? err.message : "Swap calldata failed";
      res.status(502).json({ error: message, code: "V4_SWAP_FAILED" });
    }
  },
);
