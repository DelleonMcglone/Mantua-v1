/**
 * 031 — UniversalRouter/Permit2 swap execution path (Base Mainnet).
 *
 * Builds `UniversalRouter.execute(bytes commands, bytes[] inputs,
 * uint256 deadline)` calldata for a Uniswap v4 exact-input single-pool
 * swap, replacing the PoolSwapTest path (which does not exist in the
 * canonical mainnet deployment — `poolSwapTest: null` on 8453).
 *
 * Encoding verified against the Solidity actually deployed on Base
 * (UniversalRouter 0x6fF5693b…9b43 = universal-router tag 2.0.0, whose
 * v4-periphery submodule pins commit 444c526b77d804590f0d7bc5a481af5a3277c952):
 *
 *  - universal-router `contracts/libraries/Commands.sol`:
 *      V4_SWAP = 0x10 (COMMAND_TYPE_MASK 0x7f, FLAG_ALLOW_REVERT 0x80 unset).
 *  - universal-router `contracts/UniversalRouter.sol`:
 *      `execute(bytes,bytes[],uint256)` wraps `execute(bytes,bytes[])`
 *      behind `checkDeadline` — `block.timestamp > deadline` reverts
 *      `TransactionDeadlinePassed()`.
 *  - universal-router `contracts/base/Dispatcher.sol`:
 *      the V4_SWAP branch forwards `inputs[i]` verbatim to
 *      `_executeActions`, which decodes it as the abi encoding of
 *      `(bytes actions, bytes[] params)` (v4-periphery
 *      `BaseActionsRouter._executeActions` / `CalldataDecoder`).
 *  - v4-periphery `src/libraries/Actions.sol` (pin 444c526b):
 *      SWAP_EXACT_IN_SINGLE = 0x06, SETTLE_ALL = 0x0c, TAKE_ALL = 0x0f.
 *  - v4-periphery `src/interfaces/IV4Router.sol` (pin 444c526b):
 *      ExactInputSingleParams = (PoolKey poolKey, bool zeroForOne,
 *      uint128 amountIn, uint128 amountOutMinimum, bytes hookData).
 *      (No `minHopPriceX36` — that field exists only on unreleased main.)
 *  - v4-periphery `src/V4Router.sol` (pin 444c526b) `_handleAction`:
 *      SETTLE_ALL decodes `(Currency, uint256 maxAmount)` and reverts
 *      `V4TooMuchRequested` when the swap's full input debt exceeds it;
 *      TAKE_ALL decodes `(Currency, uint256 minAmount)` and reverts
 *      `V4TooLittleReceived` when the credit is below it;
 *      `_swapExactInputSingle` additionally reverts `V4TooLittleReceived`
 *      when `amountOut < params.amountOutMinimum`.
 *
 * So — unlike the PoolSwapTest path — `amountOutMinimum` and the deadline
 * are enforced ON-CHAIN, inside the transaction the user signs.
 *
 * Funding model (universal-router `modules/Permit2Payments.sol`): the
 * router settles the input currency via
 * `PERMIT2.transferFrom(msgSender, poolManager, amount, token)`, so an
 * ERC-20 input needs two standing allowances:
 *   1. ERC-20 `approve(PERMIT2, amount)` — bounded to the trade.
 *   2. `PERMIT2.approve(token, UNIVERSAL_ROUTER, amount, expiration)` —
 *      bounded amount + short expiry.
 * Native-ETH input skips both (value rides on the execute call).
 * `planSwapApprovals` emits exactly the calls still needed, bounded to
 * the trade amount — never MaxUint (C-022 / D-110 bounded-approval
 * principle).
 */
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData } from "viem";
import type { PoolKey } from "./pool-key.ts";
import { BASE_CHAIN_ID, DEFAULT_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { getRpcClient } from "./rpc-client.ts";
import { PERMIT2_EXPIRATION_SECONDS } from "./permit2.ts";
import { ERC20_ABI, PERMIT2, PERMIT2_ABI, UNIVERSAL_ROUTER } from "./v4-contracts.ts";

// ─── Verified constants ─────────────────────────────────────────────────────

/** Commands.sol — V4_SWAP command byte. */
export const UR_COMMAND_V4_SWAP = 0x10;

/** Actions.sol (pin 444c526b) — the three actions of an exact-in single swap. */
export const V4_ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
export const V4_ACTION_SETTLE_ALL = 0x0c;
export const V4_ACTION_TAKE_ALL = 0x0f;

/**
 * How long a built swap stays executable. Bounded and non-configurable:
 * long enough for a wallet prompt + Base inclusion, short enough that a
 * signed-but-delayed transaction can't execute against a stale quote
 * far in the future.
 */
export const SWAP_DEADLINE_SECONDS = 10 * 60;

/** uint128 ceiling — ExactInputSingleParams amounts are uint128. */
const MAX_UINT128 = (1n << 128n) - 1n;
/** uint160 ceiling — Permit2 allowance amounts are uint160. */
const MAX_UINT160 = (1n << 160n) - 1n;

/** Re-issue a Permit2 allowance when it expires within this window —
 *  mirrors agent-liquidity's PERMIT2_VALIDITY_BUFFER_SECONDS intent. */
export const PERMIT2_VALIDITY_BUFFER_SECONDS = 300;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** UniversalRouter `execute(bytes,bytes[],uint256)` — selector 0x3593564c. */
export const UNIVERSAL_ROUTER_EXECUTE_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { type: "bytes", name: "commands" },
      { type: "bytes[]", name: "inputs" },
      { type: "uint256", name: "deadline" },
    ],
    outputs: [],
  },
] as const;

/** Permit2 `approve(token, spender, uint160 amount, uint48 expiration)`. */
export const PERMIT2_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
    ],
    outputs: [],
  },
] as const;

const UNIVERSAL_ROUTER_BY_CHAIN: Record<SupportedChainId, `0x${string}`> = {
  [BASE_CHAIN_ID]: UNIVERSAL_ROUTER,
};

export function getUniversalRouter(chainId: SupportedChainId = DEFAULT_CHAIN_ID): `0x${string}` {
  return UNIVERSAL_ROUTER_BY_CHAIN[chainId];
}

// ─── Calldata builder (pure) ────────────────────────────────────────────────

/** IV4Router.ExactInputSingleParams (pin 444c526b) as a viem tuple. */
const EXACT_IN_SINGLE_PARAMS_TUPLE = {
  type: "tuple",
  components: [
    {
      type: "tuple",
      name: "poolKey",
      components: [
        { type: "address", name: "currency0" },
        { type: "address", name: "currency1" },
        { type: "uint24", name: "fee" },
        { type: "int24", name: "tickSpacing" },
        { type: "address", name: "hooks" },
      ],
    },
    { type: "bool", name: "zeroForOne" },
    { type: "uint128", name: "amountIn" },
    { type: "uint128", name: "amountOutMinimum" },
    { type: "bytes", name: "hookData" },
  ],
} as const;

export interface UniversalRouterSwapArgs {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountInRaw: bigint;
  /** On-chain floor for the output — enforced by both the router's
   *  `amountOutMinimum` check and the TAKE_ALL `minAmount` check. */
  amountOutMinimum: bigint;
  /** Unix-seconds clock, injected so the builder is pure and testable. */
  nowSeconds: number;
  chainId?: SupportedChainId;
}

export interface UniversalRouterSwapCalldata {
  to: `0x${string}`;
  data: `0x${string}`;
  /** Attached ETH — the input amount for native-ETH input, else "0". */
  value: string;
  /** Unix-seconds deadline encoded in the calldata. */
  deadline: string;
}

/**
 * Encode a v4 exact-input single swap as one UniversalRouter execute call:
 * command V4_SWAP whose input is (actions = [SWAP_EXACT_IN_SINGLE,
 * SETTLE_ALL, TAKE_ALL], params matching each action). Pure — no RPC.
 */
export function buildUniversalRouterSwapCalldata(
  args: UniversalRouterSwapArgs,
): UniversalRouterSwapCalldata {
  const { poolKey, zeroForOne, amountInRaw, amountOutMinimum, nowSeconds } = args;
  if (amountInRaw <= 0n) throw new Error("amountInRaw must be positive");
  if (amountInRaw > MAX_UINT128) throw new Error("amountInRaw exceeds uint128");
  // Fail closed: a zero min-out means no slippage protection at all —
  // refuse to build calldata that could be signed into an unbounded fill.
  if (amountOutMinimum <= 0n) throw new Error("amountOutMinimum must be positive");
  if (amountOutMinimum > MAX_UINT128) throw new Error("amountOutMinimum exceeds uint128");

  const inputCurrency = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  const swapParams = encodeAbiParameters(
    [EXACT_IN_SINGLE_PARAMS_TUPLE],
    [
      {
        poolKey: {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        },
        zeroForOne,
        amountIn: amountInRaw,
        amountOutMinimum,
        hookData: "0x",
      },
    ],
  );
  // SETTLE_ALL(currency, maxAmount) — exact-in, so the full input debt is
  // exactly amountIn; cap the settle at that.
  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [inputCurrency, amountInRaw],
  );
  // TAKE_ALL(currency, minAmount) — the output credit must be ≥ min-out.
  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [outputCurrency, amountOutMinimum],
  );

  const actions = ("0x" +
    [V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE_ALL, V4_ACTION_TAKE_ALL]
      .map((a) => a.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
  const v4SwapInput = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, [swapParams, settleParams, takeParams]],
  );

  const commands = ("0x" + UR_COMMAND_V4_SWAP.toString(16).padStart(2, "0")) as `0x${string}`;
  const deadline = BigInt(nowSeconds + SWAP_DEADLINE_SECONDS);
  const data = encodeFunctionData({
    abi: UNIVERSAL_ROUTER_EXECUTE_ABI,
    functionName: "execute",
    args: [commands, [v4SwapInput], deadline],
  });

  const isNativeIn = inputCurrency.toLowerCase() === ZERO_ADDRESS;
  return {
    to: getUniversalRouter(args.chainId),
    data,
    value: isNativeIn ? amountInRaw.toString() : "0",
    deadline: deadline.toString(),
  };
}

// ─── Approval planning (pure) ───────────────────────────────────────────────

export interface SwapAllowanceState {
  /** ERC-20 allowance owner → Permit2. */
  erc20Allowance: bigint;
  /** Permit2 allowance amount (uint160) owner/token → UniversalRouter. */
  permit2Allowance: bigint;
  /** Unix-seconds expiry of that Permit2 allowance. */
  permit2Expiration: number;
}

/**
 * One approval transaction, carried in both shapes callers need:
 * `{to, data, value}` for a user wallet (`sendTransaction`) and
 * `{abiFunctionSignature, abiParameters}` for a Circle DCW
 * (`executeAgentAbiCall`). Both encode the identical call.
 */
export interface PlannedSwapApproval {
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0";
  abiFunctionSignature: string;
  abiParameters: string[];
  description: string;
}

/**
 * Which approvals a swap still needs, bounded to exactly this trade's
 * input amount (never MaxUint — C-022). Allowances that already cover
 * the trade are reused; a Permit2 grant that is expired or expiring
 * within PERMIT2_VALIDITY_BUFFER_SECONDS is re-issued with a bounded
 * PERMIT2_EXPIRATION_SECONDS expiry. Pure so it stays unit-testable.
 */
export function planSwapApprovals(params: {
  token: `0x${string}`;
  requiredRaw: bigint;
  state: SwapAllowanceState;
  nowSeconds: number;
  chainId?: SupportedChainId;
}): PlannedSwapApproval[] {
  const { token, requiredRaw, state, nowSeconds } = params;
  if (requiredRaw <= 0n) throw new Error("requiredRaw must be positive");
  if (requiredRaw > MAX_UINT160) throw new Error("requiredRaw exceeds uint160");
  const router = getUniversalRouter(params.chainId);
  const calls: PlannedSwapApproval[] = [];

  if (state.erc20Allowance < requiredRaw) {
    calls.push({
      to: token,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [PERMIT2, requiredRaw],
      }),
      value: "0",
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [PERMIT2, requiredRaw.toString()],
      description: `Approve ${requiredRaw.toString()} raw units to Permit2`,
    });
  }

  const expiredSoon = state.permit2Expiration <= nowSeconds + PERMIT2_VALIDITY_BUFFER_SECONDS;
  if (state.permit2Allowance < requiredRaw || expiredSoon) {
    const expiration = nowSeconds + PERMIT2_EXPIRATION_SECONDS;
    calls.push({
      to: PERMIT2,
      data: encodeFunctionData({
        abi: PERMIT2_APPROVE_ABI,
        functionName: "approve",
        args: [token, router, requiredRaw, expiration],
      }),
      value: "0",
      abiFunctionSignature: "approve(address,address,uint160,uint48)",
      abiParameters: [token, router, requiredRaw.toString(), expiration.toString()],
      description: `Permit2-approve ${requiredRaw.toString()} raw units to the UniversalRouter`,
    });
  }

  return calls;
}

/** Live allowance reads backing `planSwapApprovals` for one owner+token. */
export async function readSwapAllowanceState(
  owner: `0x${string}`,
  token: `0x${string}`,
  chainId: SupportedChainId = DEFAULT_CHAIN_ID,
): Promise<SwapAllowanceState> {
  const rpc = getRpcClient(chainId);
  const [erc20Allowance, permit2] = await Promise.all([
    rpc.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, PERMIT2],
    }),
    rpc.readContract({
      address: PERMIT2,
      abi: PERMIT2_ABI,
      functionName: "allowance",
      args: [owner, token, getUniversalRouter(chainId)],
    }),
  ]);
  const [permit2Allowance, permit2Expiration] = permit2;
  return { erc20Allowance, permit2Allowance, permit2Expiration };
}

// ─── Full plan (calldata + approvals) ───────────────────────────────────────

export interface UniversalRouterSwapPlan extends UniversalRouterSwapCalldata {
  /** Transactions to send (in order) BEFORE the swap. Empty when the
   *  standing allowances already cover the trade, or input is native. */
  approvals: PlannedSwapApproval[];
  amountOutMinimum: string;
}

/**
 * Build the router calldata plus the bounded approval plan for `owner`.
 * One RPC round (two parallel reads) for ERC-20 input; none for native.
 */
export async function buildUniversalRouterSwap(args: {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountInRaw: bigint;
  amountOutMinimum: bigint;
  owner: `0x${string}`;
  chainId?: SupportedChainId;
  nowSeconds?: number;
}): Promise<UniversalRouterSwapPlan> {
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const chainId = args.chainId ?? DEFAULT_CHAIN_ID;
  const calldata = buildUniversalRouterSwapCalldata({
    poolKey: args.poolKey,
    zeroForOne: args.zeroForOne,
    amountInRaw: args.amountInRaw,
    amountOutMinimum: args.amountOutMinimum,
    nowSeconds,
    chainId,
  });

  const inputCurrency = args.zeroForOne ? args.poolKey.currency0 : args.poolKey.currency1;
  let approvals: PlannedSwapApproval[] = [];
  if (inputCurrency.toLowerCase() !== ZERO_ADDRESS) {
    const state = await readSwapAllowanceState(args.owner, inputCurrency, chainId);
    approvals = planSwapApprovals({
      token: inputCurrency,
      requiredRaw: args.amountInRaw,
      state,
      nowSeconds,
      chainId,
    });
  }

  return { ...calldata, approvals, amountOutMinimum: args.amountOutMinimum.toString() };
}

/**
 * Derive the on-chain min-out from a fresh quote and a slippage
 * tolerance in bps: `amountOut * (10000 - slippageBps) / 10000`.
 */
export function minOutFromQuote(amountOut: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error("slippageBps must be an integer in [0, 10000)");
  }
  return (amountOut * (10_000n - BigInt(slippageBps))) / 10_000n;
}

/** Test helper — decode an execute() calldata back into its parts. */
export function decodeUniversalRouterExecute(data: `0x${string}`): {
  commands: `0x${string}`;
  inputs: readonly `0x${string}`[];
  deadline: bigint;
} {
  const decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, data });
  const [commands, inputs, deadline] = decoded.args;
  return { commands, inputs, deadline };
}
