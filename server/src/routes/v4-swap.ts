import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { DEFAULT_CHAIN_ID, isSupportedChainId, type SupportedChainId } from "../lib/chains.ts";
import { isTokenSymbol } from "../lib/tokens.ts";
import {
  HookNotDeployedError,
  decodeSwapRevertReason,
  findMaxQuotableInputV4,
  quoteExactInputV4,
} from "../lib/v4-onchain-swap.ts";
import { buildUniversalRouterSwap, minOutFromQuote } from "../lib/v4-universal-router.ts";
import { isMarketPoolHook } from "../lib/swap-route.ts";
import { MAX_SLIPPAGE_BPS } from "../lib/constants.ts";
import { HOOK_NAMES, isFeeTier } from "../lib/v4-contracts.ts";
import { HookPairNotAllowedError } from "../lib/hook-pair-gating.ts";
import { isTransientRpcError } from "../lib/rpc-client.ts";
import { logAudit } from "../lib/audit.ts";
import { SafetyError } from "../lib/errors.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { guardSpend } from "../lib/spending-cap.ts";
import { PriceUnavailableError, tokenAmountUsdStrict } from "../lib/usd-pricing.ts";
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
      if (err instanceof HookNotDeployedError) {
        res.status(400).json({ error: err.message, code: "HOOK_NOT_DEPLOYED" });
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
  /** Slippage tolerance in bps — derives the on-chain `amountOutMinimum`.
   *  Hard-capped at MAX_SLIPPAGE_BPS (server/src/lib/constants.ts); above
   *  it the request is a 400, never a swap with a hollow min-out. */
  slippageBps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).default(50),
});

/**
 * Swap calldata — re-runs the quote (so `amountOutMinimum` derives from
 * a fresh on-chain simulation, not stale client state) and returns
 * UniversalRouter `execute` calldata for a v4 exact-in single swap.
 * Slippage protection is IN the transaction: the router enforces
 * `amountOutMinimum` (V4TooLittleReceived) and the deadline
 * (TransactionDeadlinePassed) on-chain. The response also carries
 * `approvals` — the bounded ERC-20→Permit2 / Permit2→router approval
 * transactions (if any) the wallet must send before the swap.
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
    const ctx = getRequestContext(req);
    const wallet = ctx.walletAddress;
    if (!wallet) {
      res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BYPASS_HOOK_FOR_DEMO is a togglable flag
    const effectiveHook = BYPASS_HOOK_FOR_DEMO ? null : (hook ?? null);
    try {
      // C-019 — this calldata moves the user's money once signed, so the
      // spend is priced from tokenIn (a registry symbol, not client-reported
      // USD), checked against the daily cap, and recorded as a ledger intent
      // before anything is returned (guardSpend). Quote and calldata build
      // run only after the check passes.
      const built = await guardSpend(
        // C-019 — strict pricing: a dead feed throws instead of valuing the
        // spend at $0, so the cap cannot be priced around.
        () => tokenAmountUsdStrict(tokenIn, BigInt(amountInRaw)),
        wallet,
        async () => {
          const quote = await quoteExactInputV4({
            tokenIn,
            tokenOut,
            fee,
            hook: effectiveHook,
            amountInRaw: BigInt(amountInRaw),
            chainId,
          });
          // B7-005 / DM-112 backstop — a pool keyed to the Dynamic Market
          // hook belongs to the market-trade path (its own PoolManager +
          // periphery); encoding it for the canonical UniversalRouter would
          // target the wrong v4 stack. Registry-symbol validation makes
          // this unreachable today; the assert keeps it that way.
          if (isMarketPoolHook(quote.poolKey.hooks, chainId)) {
            throw new Error(
              "Market outcome pools trade through /api/markets/trade/calldata, not the token-swap path (DM-112)",
            );
          }
          // amountOutMinimum: amountOut * (1 - slippage), enforced ON-CHAIN
          // by the UniversalRouter calldata below.
          const minOut = minOutFromQuote(BigInt(quote.amountOut), slippageBps);
          const swap = await buildUniversalRouterSwap({
            poolKey: quote.poolKey,
            zeroForOne: quote.zeroForOne,
            amountInRaw: BigInt(amountInRaw),
            amountOutMinimum: minOut,
            owner: wallet as `0x${string}`,
            chainId,
          });
          return { swap, quote, minOut };
        },
      );
      res.json({
        to: built.swap.to,
        data: built.swap.data,
        value: built.swap.value,
        deadline: built.swap.deadline,
        approvals: built.swap.approvals.map((a) => ({
          to: a.to,
          data: a.data,
          value: a.value,
          description: a.description,
        })),
        amountOutMinimum: built.minOut.toString(),
        quote: {
          amountIn: built.quote.amountIn,
          amountOut: built.quote.amountOut,
          amountOutMinimum: built.minOut.toString(),
          gasEstimate: built.quote.gasEstimate,
          poolKey: built.quote.poolKey,
          zeroForOne: built.quote.zeroForOne,
        },
      });
    } catch (err) {
      if (err instanceof PriceUnavailableError) {
        // Fail-closed: no price, no calldata that could be signed into a trade.
        res.status(503).json({ error: err.message, code: "PRICE_UNAVAILABLE" });
        return;
      }
      if (err instanceof SafetyError) {
        logger.warn({ err, wallet }, "v4 swap calldata: blocked by the spending cap");
        await logAudit({
          ...ctx,
          action: "swap",
          outcome: "rejected_cap",
          params: { tokenIn, tokenOut, amountRaw: amountInRaw },
        });
        res.status(400).json({ error: err.message, code: err.code, details: err.details });
        return;
      }
      if (err instanceof HookPairNotAllowedError) {
        res.status(400).json({ error: err.message, code: "HOOK_PAIR_NOT_ALLOWED" });
        return;
      }
      if (err instanceof HookNotDeployedError) {
        res.status(400).json({ error: err.message, code: "HOOK_NOT_DEPLOYED" });
        return;
      }
      logger.warn({ err, tokenIn, tokenOut, hook, chainId }, "v4 swap calldata failed");
      const message = err instanceof Error ? err.message : "Swap calldata failed";
      res.status(502).json({ error: message, code: "V4_SWAP_FAILED" });
    }
  },
);
