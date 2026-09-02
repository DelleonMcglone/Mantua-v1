import { BaseError, decodeAbiParameters, decodeErrorResult, encodeFunctionData } from "viem";
import { buildPoolKey, type PoolKey } from "./pool-key.ts";
import { logger } from "./logger.ts";
import { getRpcClient, isTransientRpcError } from "./rpc-client.ts";
import { DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { getToken, type TokenSymbol } from "./tokens.ts";
import {
  HOOK_NAMES,
  POOL_SWAP_TEST_ABI,
  V4_QUOTER_ABI,
  getHookAddress,
  getV4StackForHook,
  type FeeTier,
  type HookName,
} from "./v4-contracts.ts";
import { assertHookPairAllowedBySymbol } from "./hook-pair-gating.ts";
import { TtlCache } from "./ttl-cache.ts";
import { readSlot0 } from "./v4-state-view.ts";
import { computePoolId } from "./pool-id.ts";
import { parseAbi } from "viem";

/**
 * Walk a viem error tree to find the raw revert data hex string
 * (`0x<selector><payload>`). Returns null when no contract revert
 * data is attached (e.g. RPC transport error, not a revert).
 */
function extractRevertHex(err: unknown): `0x${string}` | null {
  if (!(err instanceof BaseError)) return null;
  const found = err.walk((e): e is BaseError & { data?: unknown; cause?: unknown } => {
    const candidate = e as { data?: unknown };
    return typeof candidate.data === "string" && candidate.data.startsWith("0x");
  }) as (BaseError & { data?: `0x${string}` }) | null;
  return found?.data ?? null;
}

interface DecodedQuoterRevert {
  outerHex: `0x${string}` | null;
  innerHex: `0x${string}` | null;
  innerSelector: `0x${string}` | null;
  decoded: string | null;
  /** When inner is v4-core's `WrappedError(address,bytes4,bytes,bytes)`,
   *  the unwrapped hook-side revert reason + best-effort decoding. */
  hookTarget?: `0x${string}`;
  hookFnSelector?: `0x${string}`;
  hookReasonHex?: `0x${string}`;
  hookReasonSelector?: `0x${string}`;
  hookReasonDecoded?: string;
}

/**
 * Known stable-protection-hook custom errors. Mirror of the on-chain
 * ABI for `0xe5e6a9...20C0` — used to translate `0x<selector>` bytes
 * coming back through `WrappedError` into a readable name.
 */
const STABLE_PROTECTION_HOOK_ERRORS = [
  {
    type: "error",
    name: "CircuitBreakerTripped",
    inputs: [
      { type: "uint8", name: "zone" },
      { type: "uint256", name: "deviationBps" },
    ],
  },
  { type: "error", name: "InvalidConfiguration", inputs: [{ type: "string", name: "reason" }] },
  { type: "error", name: "NotPoolManager", inputs: [] },
  { type: "error", name: "AlreadyInitialized", inputs: [] },
  // DynamicFee hook: beforeSwap reverts PoolNotConfigured(poolId) when the
  // pool wasn't set up via the owner-only configurePool() call.
  { type: "error", name: "PoolNotConfigured", inputs: [{ type: "bytes32", name: "poolId" }] },
  // RWAGate hook: beforeSwap reverts NotWhitelisted(account) when the caller
  // isn't allowlisted in the hook's ComplianceRegistry.
  { type: "error", name: "NotWhitelisted", inputs: [{ type: "address", name: "account" }] },
  // v4-core: the pool has no (in-range) liquidity to swap against — e.g. a
  // pool that was created/configured but never funded.
  { type: "error", name: "NotEnoughLiquidity", inputs: [{ type: "bytes32", name: "poolId" }] },
] as const;

/**
 * Decode `0x<selector><payload>` into a readable string. Handles
 * `Error(string)`, `Panic(uint256)`, and any custom error in
 * `STABLE_PROTECTION_HOOK_ERRORS`. Returns null when nothing matches.
 */
function decodeRevertBytes(hex: `0x${string}`): string | null {
  if (hex.length < 10) return null;
  try {
    const decoded = decodeErrorResult({
      abi: [
        { type: "error", name: "Error", inputs: [{ type: "string", name: "message" }] },
        { type: "error", name: "Panic", inputs: [{ type: "uint256", name: "code" }] },
        ...STABLE_PROTECTION_HOOK_ERRORS,
      ],
      data: hex,
    });
    if (decoded.errorName === "Error") {
      const message = decoded.args[0];
      return `Error: ${typeof message === "string" ? message : "(non-string)"}`;
    }
    if (decoded.errorName === "Panic") {
      const code = decoded.args[0];
      return `Panic(0x${typeof code === "bigint" ? code.toString(16) : "?"})`;
    }
    const argsStr = (decoded.args as readonly unknown[])
      .map((a) => (typeof a === "bigint" ? a.toString() : JSON.stringify(a)))
      .join(", ");
    return `${decoded.errorName}(${argsStr})`;
  } catch {
    return null;
  }
}

/**
 * Decode the inner revert payload from V4Quoter's
 * `UnexpectedRevertBytes(bytes)` (selector `0x6190b2b0`). When that
 * inner payload is v4-core's `WrappedError(address,bytes4,bytes,bytes)`
 * (selector `0x90bfb865`) — which is how PoolManager wraps any hook
 * revert — peel that wrapper too and surface the actual hook-side
 * revert reason. Otherwise return whatever we could decode.
 */
function decodeQuoterRevert(err: unknown): DecodedQuoterRevert {
  const outerHex = extractRevertHex(err);
  if (!outerHex) return { outerHex: null, innerHex: null, innerSelector: null, decoded: null };

  // UnexpectedRevertBytes(bytes) — selector 0x6190b2b0.
  if (!outerHex.toLowerCase().startsWith("0x6190b2b0")) {
    return {
      outerHex,
      innerHex: null,
      innerSelector: outerHex.slice(0, 10).toLowerCase() as `0x${string}`,
      decoded: decodeRevertBytes(outerHex),
    };
  }
  let innerHex: `0x${string}`;
  try {
    const payload = ("0x" + outerHex.slice(10)) as `0x${string}`;
    const [bytes] = decodeAbiParameters([{ type: "bytes" }], payload);
    innerHex = bytes;
  } catch {
    return { outerHex, innerHex: null, innerSelector: null, decoded: "unwrap failed" };
  }
  if (innerHex.length < 10) {
    return { outerHex, innerHex, innerSelector: null, decoded: "empty inner payload" };
  }
  const innerSelector = innerHex.slice(0, 10).toLowerCase() as `0x${string}`;

  // v4-core's WrappedError(address,bytes4,bytes,bytes) — selector 0x90bfb865.
  // PoolManager uses this whenever a hook callback reverts. Peel it
  // to surface the hook's actual revert reason.
  if (innerSelector === "0x90bfb865") {
    try {
      const payload = ("0x" + innerHex.slice(10)) as `0x${string}`;
      const [target, fnSelector, reason] = decodeAbiParameters(
        [
          { type: "address", name: "target" },
          { type: "bytes4", name: "selector" },
          { type: "bytes", name: "reason" },
          { type: "bytes", name: "details" },
        ],
        payload,
      ) as unknown as [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];
      const reasonSelector =
        reason.length >= 10 ? (reason.slice(0, 10).toLowerCase() as `0x${string}`) : undefined;
      const reasonDecoded = decodeRevertBytes(reason);
      return {
        outerHex,
        innerHex,
        innerSelector,
        decoded:
          reasonDecoded ?? `WrappedError(hook=${target}, fn=${fnSelector}, reason=${reason})`,
        hookTarget: target,
        hookFnSelector: fnSelector,
        hookReasonHex: reason,
        ...(reasonSelector ? { hookReasonSelector: reasonSelector } : {}),
        ...(reasonDecoded ? { hookReasonDecoded: reasonDecoded } : {}),
      };
    } catch {
      return {
        outerHex,
        innerHex,
        innerSelector,
        decoded: "WrappedError unwrap failed",
      };
    }
  }

  return {
    outerHex,
    innerHex,
    innerSelector,
    decoded: decodeRevertBytes(innerHex),
  };
}

/**
 * Best-effort decoded reason for a failed quote/swap — the hook's named
 * custom error (PoolNotConfigured / NotWhitelisted / NotEnoughLiquidity /
 * CircuitBreakerTripped / …) when we can decode it, else null. Unwraps the
 * `friendlyQuoterError` wrapper to reach the original viem revert. Callers
 * fall back to a generic string when this returns null. The client maps the
 * named error to an actionable sentence (humanizeRevertReason).
 */
export function decodeSwapRevertReason(err: unknown): string | null {
  const cause = err instanceof Error && err.cause ? err.cause : err;
  const decoded = decodeQuoterRevert(cause);
  return decoded.hookReasonDecoded ?? decoded.decoded ?? null;
}

/**
 * v4 sqrt price limits. Anything inside `MIN_SQRT_PRICE_LIMIT <
 * sqrtPriceX96 < MAX_SQRT_PRICE_LIMIT` is accepted; using these
 * extremes effectively disables price-impact protection at the
 * PoolManager level. Slippage is enforced upstream via the quote +
 * client-supplied tolerance.
 */
const MIN_SQRT_PRICE_LIMIT = 4295128740n; // TickMath.MIN_SQRT_PRICE + 1
const MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n; // TickMath.MAX_SQRT_PRICE - 1

export interface OnchainQuoteArgs {
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  fee: FeeTier;
  hook: HookName | null;
  amountInRaw: bigint;
  /** Target chain for the on-chain quote. Defaults to Base Mainnet
   *  for legacy callers that haven't been threaded yet. */
  chainId?: SupportedChainId;
  /** Internal: skip on-chain fee-tier auto-resolution because the caller
   *  already resolved which tier is initialized (avoids redundant slot0
   *  reads on every binary-search probe). */
  _skipResolve?: boolean;
}

export interface OnchainQuoteResult {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: string;
  amountOut: string;
  gasEstimate: string;
}

function resolveHookAddress(
  hook: HookName | null,
  chainId: SupportedChainId,
): `0x${string}` {
  if (!hook) return "0x0000000000000000000000000000000000000000";
  if (!HOOK_NAMES.includes(hook)) return "0x0000000000000000000000000000000000000000";
  return getHookAddress(hook, chainId) ?? "0x0000000000000000000000000000000000000000";
}

/** Standard static fee tiers, probed when the requested tier has no pool. */
const CANDIDATE_FEES: readonly FeeTier[] = [100, 500, 3000, 10000];

/**
 * Find the fee tier whose pool is actually initialized on-chain for this
 * pair + hook. The UI derives a tier from the hook (e.g. no-hook → 0.30%),
 * but the real pool may sit at a different standard tier — a no-hook
 * USDC/EURC pool created at 0.01%, say. Probe the requested tier first,
 * then the other standard tiers; return null if none is initialized.
 */
/**
 * Tier resolution is sticky — an initialized pool never de-initializes —
 * so cache hits long. A null (no pool at any tier) is cached briefly so a
 * just-created pool is picked up within seconds. Collapses the up-to-4
 * slot0 probes this does per quote / max-input call.
 */
/** The Stable Protection hook's swap-halting threshold (PegMonitor
 *  SEVERE_BPS): past it the zone is CRITICAL and every swap reverts. */
const SP_CRITICAL_BPS = 500n;
const SP_DEVIATION_ABI = parseAbi([
  "function currentDeviationBps(bytes32 poolId) view returns (uint256)",
]);

const resolvedFeeCache = new TtlCache<FeeTier | null>();
const RESOLVED_FEE_TTL_MS = 10 * 60_000;
const RESOLVED_FEE_NULL_TTL_MS = 10_000;

async function resolveInitializedFee(
  tokenIn: TokenSymbol,
  tokenOut: TokenSymbol,
  hook: HookName | null,
  requestedFee: FeeTier,
  chainId: SupportedChainId,
): Promise<FeeTier | null> {
  // The pool key sorts currencies, so direction doesn't matter — normalize
  // the pair in the cache key to share hits across both directions.
  const pair = [tokenIn, tokenOut].sort().join("/");
  return resolvedFeeCache.get(
    `${String(chainId)}:${pair}:${hook ?? "none"}:${String(requestedFee)}`,
    async () => {
      const hookAddr = resolveHookAddress(hook, chainId);
      const tiers: FeeTier[] = [requestedFee, ...CANDIDATE_FEES.filter((f) => f !== requestedFee)];
      for (const fee of tiers) {
        const { key } = buildPoolKey(tokenIn, tokenOut, fee, hookAddr, hook, chainId);
        const slot0 = await readSlot0(key, chainId);
        if (!slot0) continue;
        // An initialized Stable Protection pool can still be permanently
        // dead: past its CRITICAL threshold the hook reverts every swap,
        // and with swaps blocked the price can never come back. Skip such
        // a pool so a healthy pool at another tier can serve the pair
        // (Base carries one of these — a USDC/EURC pool crashed by test
        // swaps against dust liquidity). Fail-open: if the deviation read
        // itself fails, keep the old behavior and use the pool.
        if (hook === "stable-protection") {
          try {
            const deviationBps = await getRpcClient(chainId).readContract({
              address: hookAddr,
              abi: SP_DEVIATION_ABI,
              functionName: "currentDeviationBps",
              args: [computePoolId(key)],
            });
            if (deviationBps > SP_CRITICAL_BPS) continue;
          } catch {
            // older/newer hook build without the getter — use the pool
          }
        }
        return fee;
      }
      return null;
    },
    (v) => (v === null ? RESOLVED_FEE_NULL_TTL_MS : RESOLVED_FEE_TTL_MS),
  );
}

/**
 * Inspect a viem-thrown error from V4Quoter and turn known reverts
 * into human-friendly messages. Quoter wraps any internal failure as
 * `UnexpectedRevertBytes(bytes)` (selector `0x6190b2b0`) — that
 * usually means the pool hasn't been initialized for the requested
 * key, the hook rejected the swap, or the input amount exceeded
 * available liquidity.
 */
function friendlyQuoterError(err: unknown): Error {
  // Prefer the specific inner hook/pool revert (CircuitBreakerTripped,
  // PoolNotConfigured, NotWhitelisted, NotEnoughLiquidity, …) when we can
  // unwrap it — the generic "missing liquidity" fallback below is misleading
  // for an initialized pool whose hook actively rejected the swap.
  const inner = decodeQuoterRevert(err);
  const specific = inner.hookReasonDecoded ?? inner.decoded;
  if (specific) return new Error(specific, { cause: err });

  const msg = err instanceof Error ? err.message : String(err);
  if (/0x6190b2b0|UnexpectedRevertBytes/i.test(msg)) {
    return new Error(
      "Quote failed — pool may be missing liquidity, the hook rejected the swap, or the requested amount is larger than the pool can support. Try a smaller amount.",
      { cause: err },
    );
  }
  if (/PoolNotInitialized|0x[0-9a-f]+ not initialized/i.test(msg)) {
    return new Error("Pool not initialized for this pair + fee + hook combination.", {
      cause: err,
    });
  }
  if (err instanceof Error) return err;
  return new Error("Quote failed");
}

/**
 * Binary-search the largest input amount that V4Quoter can quote for
 * the given pool key without reverting. Used by the swap panel's
 * percent chips so a 25% / 50% / Max click can't overshoot
 * pool depth (or land on a non-existent pool).
 *
 * `upperBound` is the user's wallet balance in raw base units —
 * if the pool can absorb that much, we short-circuit and return it
 * directly. Otherwise we binary-search the [0, upperBound] interval.
 *
 * 24 iterations is enough to converge on any bound under 2^24 of
 * raw-unit precision, which for a 6-dec stablecoin is ~16 USD —
 * fine resolution for percent chips. Each iteration is one
 * `eth_call`; total worst-case RPC fan-out is 25 (one direct probe
 * + 24 search steps), only fired when the user actually clicks
 * a percent chip.
 */
export interface MaxQuotableResult {
  maxInput: bigint;
  /** When every probe reverted, a human-readable reason derived from
   *  the upper-bound probe's revert data. Null when the pool absorbed
   *  the swap or when no decode was possible. */
  reason: string | null;
  /** True when the probe couldn't run (transient RPC failure) and the
   *  result failed open to the upper bound. Not cached. */
  transient?: boolean;
}

/**
 * The probe costs up to 25 eth_calls, and the panel re-fires it on every
 * token/balance change — cache per exact args for a minute so remounts and
 * repeat visits don't re-run the binary search against a rate-limited RPC.
 * Transient (failed-open) results are not cached.
 */
const maxInputCache = new TtlCache<MaxQuotableResult>();
const MAX_INPUT_TTL_MS = 60_000;

export async function findMaxQuotableInputV4(
  args: Omit<OnchainQuoteArgs, "amountInRaw"> & { upperBound: bigint },
): Promise<MaxQuotableResult> {
  const cacheKey = [
    String(args.chainId ?? DEFAULT_CHAIN_ID),
    args.tokenIn,
    args.tokenOut,
    String(args.fee),
    args.hook ?? "none",
    args.upperBound.toString(),
  ].join(":");
  return maxInputCache.get(
    cacheKey,
    () => findMaxQuotableInputV4Uncached(args),
    (v) => (v.transient ? 0 : MAX_INPUT_TTL_MS),
  );
}

async function findMaxQuotableInputV4Uncached(
  args: Omit<OnchainQuoteArgs, "amountInRaw"> & { upperBound: bigint },
): Promise<MaxQuotableResult> {
  const { upperBound, ...rest } = args;
  if (upperBound === 0n) return { maxInput: 0n, reason: null };
  // Skip the 25 wasted `eth_call`s when the hook×pair combo is
  // already known to be disallowed — surfaces the same maxInput=0
  // outcome the binary search would converge on.
  if (rest.hook) {
    assertHookPairAllowedBySymbol(rest.hook, rest.tokenIn, rest.tokenOut);
  }

  // Resolve the actually-initialized fee tier once, then reuse it for every
  // probe (each probe skips re-resolving to keep the RPC fan-out bounded).
  const chainId = rest.chainId ?? DEFAULT_CHAIN_ID;
  const resolvedFee =
    (await resolveInitializedFee(rest.tokenIn, rest.tokenOut, rest.hook, rest.fee, chainId)) ??
    rest.fee;
  const probe = { ...rest, fee: resolvedFee, _skipResolve: true };

  // Direct probe at the full upper bound — if it works, the pool can
  // absorb the user's whole balance and no cap is needed. On failure
  // we hold onto the raw viem error so we can decode V4Quoter's
  // `UnexpectedRevertBytes` wrapper and surface the actual inner
  // revert reason when every later probe also reverts.
  const firstError = await (async (): Promise<unknown> => {
    try {
      await quoteExactInputV4({ ...probe, amountInRaw: upperBound });
      return null;
    } catch (err) {
      return err;
    }
  })();
  if (firstError === null) return { maxInput: upperBound, reason: null };

  // A transient RPC failure (rate limit / timeout) is NOT a hook rejection —
  // don't run 24 more doomed probes against a limited endpoint, and don't
  // surface the raw RPC text as a "rejected by hook" reason. Fail open to the
  // uncapped balance; the quote + execution path still validates the swap.
  if (isTransientRpcError(firstError)) {
    logger.warn(
      { tokenIn: args.tokenIn, tokenOut: args.tokenOut, hook: args.hook },
      "v4 max-input: transient RPC failure — failing open to upper bound",
    );
    return { maxInput: upperBound, reason: null, transient: true };
  }

  let lo = 0n;
  let hi = upperBound;
  for (let i = 0; i < 24; i++) {
    if (hi - lo <= 1n) break;
    const mid = (lo + hi) / 2n;
    if (mid === lo) break;
    try {
      await quoteExactInputV4({ ...probe, amountInRaw: mid });
      lo = mid;
    } catch {
      hi = mid;
    }
  }
  let reason: string | null = null;
  if (lo === 0n) {
    // Every probe reverted — the pool may be missing, the hook may be
    // rejecting, or liquidity may be out of range. Decode V4Quoter's
    // `UnexpectedRevertBytes` wrapper from the upper-bound probe to
    // surface the actual inner selector + reason. Walks the original
    // viem error chained via `cause` from `friendlyQuoterError`.
    const cause = firstError instanceof Error && firstError.cause ? firstError.cause : firstError;
    const decodedRevert = decodeQuoterRevert(cause);
    const friendlyMessage = firstError instanceof Error ? firstError.message : "non-Error throw";
    reason = decodedRevert.hookReasonDecoded ?? decodedRevert.decoded ?? friendlyMessage;
    // When we couldn't decode a specific pool/hook reason, the generic
    // friendlyMessage ("pool may be missing liquidity…") is misleading
    // for a pool that actually exists. Disambiguate with a slot0 read so
    // an initialized pool reports a hook/liquidity rejection, not a
    // missing pool. One extra eth_call, only on the undecodable path.
    if (!decodedRevert.hookReasonDecoded && !decodedRevert.decoded) {
      try {
        const hookAddr = resolveHookAddress(args.hook, chainId);
        const { key } = buildPoolKey(
          args.tokenIn,
          args.tokenOut,
          resolvedFee,
          hookAddr,
          args.hook,
          chainId,
        );
        const slot0 = await readSlot0(key, chainId);
        reason = slot0
          ? "The pool exists but the swap was rejected — the hook may have paused swaps (e.g. Stable Protection's circuit breaker during a depeg) or liquidity is out of range. Try a smaller amount or a different hook."
          : "No pool is initialized for this pair at this fee tier and hook. Try a different fee tier, hook, or pair.";
      } catch {
        // Keep the friendlyMessage fallback if the slot0 read fails.
      }
    }
    logger.warn(
      {
        tokenIn: args.tokenIn,
        tokenOut: args.tokenOut,
        fee: args.fee,
        hook: args.hook,
        upperBound: upperBound.toString(),
        friendly: friendlyMessage.slice(0, 200),
        outerHex: decodedRevert.outerHex ? decodedRevert.outerHex.slice(0, 80) : null,
        innerSelector: decodedRevert.innerSelector,
        innerHex: decodedRevert.innerHex ? decodedRevert.innerHex.slice(0, 600) : null,
        decoded: decodedRevert.decoded,
        hookTarget: decodedRevert.hookTarget,
        hookFnSelector: decodedRevert.hookFnSelector,
        hookReasonSelector: decodedRevert.hookReasonSelector,
        hookReasonHex: decodedRevert.hookReasonHex
          ? decodedRevert.hookReasonHex.slice(0, 400)
          : undefined,
        hookReasonDecoded: decodedRevert.hookReasonDecoded,
      },
      "v4 max-input: every probe reverted",
    );
  }
  return { maxInput: lo, reason };
}

/**
 * Build the v4 PoolKey and call `V4Quoter.quoteExactInputSingle` via
 * `eth_call`. Returns the simulated `amountOut` plus the constructed
 * `poolKey` (caller will reuse it to build PoolSwapTest calldata).
 */
export async function quoteExactInputV4(args: OnchainQuoteArgs): Promise<OnchainQuoteResult> {
  // Reject hook/pair combos the hook is known to reject on-chain
  // before burning an `eth_call`. Surfaces a clean reason instead of
  // V4Quoter's wrapped revert.
  if (args.hook) {
    assertHookPairAllowedBySymbol(args.hook, args.tokenIn, args.tokenOut);
  }
  const chainId = args.chainId ?? DEFAULT_CHAIN_ID;
  const hookAddress = resolveHookAddress(args.hook, chainId);
  // The UI derives the fee tier from the hook, which may not match the tier
  // the pool was actually created at. Resolve to the initialized tier so the
  // quote (and the swap calldata built from this poolKey) hit the real pool.
  const fee = args._skipResolve
    ? args.fee
    : ((await resolveInitializedFee(args.tokenIn, args.tokenOut, args.hook, args.fee, chainId)) ??
      args.fee);
  const { key } = buildPoolKey(args.tokenIn, args.tokenOut, fee, hookAddress, args.hook, chainId);

  const tokenInAddr = getToken(args.tokenIn, chainId).native
    ? "0x0000000000000000000000000000000000000000"
    : getToken(args.tokenIn, chainId).address;
  const zeroForOne = tokenInAddr.toLowerCase() === key.currency0.toLowerCase();

  try {
    const { result } = await getRpcClient(chainId).simulateContract({
      address: getV4StackForHook(key.hooks, chainId).quoter,
      abi: V4_QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: {
            currency0: key.currency0,
            currency1: key.currency1,
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: key.hooks,
          },
          zeroForOne,
          exactAmount: args.amountInRaw,
          hookData: "0x",
        },
      ],
    });
    const [amountOut, gasEstimate] = result;
    return {
      poolKey: key,
      zeroForOne,
      amountIn: args.amountInRaw.toString(),
      amountOut: amountOut.toString(),
      gasEstimate: gasEstimate.toString(),
    };
  } catch (err) {
    throw friendlyQuoterError(err);
  }
}

export interface SwapCalldataArgs {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountInRaw: bigint;
  /** Target chain — picks the right PoolSwapTest deployment. */
  chainId?: SupportedChainId;
}

export interface SwapCalldataResult {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  /** Approval target for the input ERC-20. Null when input is native ETH. */
  approvalTarget: `0x${string}` | null;
}

/**
 * Build calldata for `PoolSwapTest.swap`. Caller (the client) must
 * either approve the input ERC-20 to `approvalTarget` first or — for
 * native ETH input — pass the right `value` and skip the approval.
 *
 * `sqrtPriceLimitX96` is set to the absolute extremes so the
 * PoolManager doesn't reject on price-bound — the user's effective
 * slippage protection is the `amountOutMinimum` we'll surface in the
 * UI from the quote (this signature returns the raw swap; min-out
 * checking is on the caller).
 */
export function buildPoolSwapTestCalldata(args: SwapCalldataArgs): SwapCalldataResult {
  const poolSwapTest = getV4StackForHook(args.poolKey.hooks, args.chainId).poolSwapTest;
  if (!poolSwapTest) {
    throw new Error("PoolSwapTest is not deployed for this pool's hook stack");
  }
  const sqrtPriceLimit = args.zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT;
  // amountSpecified: negative = exact-input (the convention v4-core uses).
  const amountSpecified = -args.amountInRaw;
  const data = encodeFunctionData({
    abi: POOL_SWAP_TEST_ABI,
    functionName: "swap",
    args: [
      {
        currency0: args.poolKey.currency0,
        currency1: args.poolKey.currency1,
        fee: args.poolKey.fee,
        tickSpacing: args.poolKey.tickSpacing,
        hooks: args.poolKey.hooks,
      },
      {
        zeroForOne: args.zeroForOne,
        amountSpecified,
        sqrtPriceLimitX96: sqrtPriceLimit,
      },
      {
        takeClaims: false,
        settleUsingBurn: false,
      },
      "0x",
    ],
  });

  const inputCurrency = args.zeroForOne ? args.poolKey.currency0 : args.poolKey.currency1;
  const isNativeIn = inputCurrency.toLowerCase() === "0x0000000000000000000000000000000000000000";

  return {
    to: poolSwapTest,
    data,
    value: isNativeIn ? args.amountInRaw.toString() : "0",
    approvalTarget: isNativeIn ? null : poolSwapTest,
  };
}
