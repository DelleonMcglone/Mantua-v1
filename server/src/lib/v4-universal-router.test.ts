/**
 * 031 — UniversalRouter swap calldata layout + bounded approval plan.
 *
 * The layout tests decode the built calldata with viem against the same
 * ABIs the builder encodes with, and pin the byte-level constants
 * (selector, command byte, action bytes) that were verified against the
 * deployed Solidity (universal-router 2.0.0 / v4-periphery pin
 * 444c526b — see the header of v4-universal-router.ts). If any constant
 * drifts, a signed swap would target the wrong dispatch path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, decodeFunctionData, toFunctionSelector } from "viem";
import type { PoolKey } from "./pool-key.ts";
import { PERMIT2_EXPIRATION_SECONDS } from "./permit2.ts";
import { PERMIT2, UNIVERSAL_ROUTER } from "./v4-contracts.ts";
import {
  PERMIT2_APPROVE_ABI,
  PERMIT2_VALIDITY_BUFFER_SECONDS,
  SWAP_DEADLINE_SECONDS,
  UNIVERSAL_ROUTER_EXECUTE_ABI,
  UR_COMMAND_V4_SWAP,
  V4_ACTION_SETTLE_ALL,
  V4_ACTION_SWAP_EXACT_IN_SINGLE,
  V4_ACTION_TAKE_ALL,
  buildUniversalRouterSwapCalldata,
  minOutFromQuote,
  planSwapApprovals,
  type SwapAllowanceState,
} from "./v4-universal-router.ts";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const EURC = "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const NOW = 1_800_000_000;

const POOL_KEY: PoolKey = {
  currency0: EURC,
  currency1: USDC,
  fee: 500,
  tickSpacing: 10,
  hooks: ZERO,
};

const AMOUNT_IN = 25_000_000n; // 25 USDC
const MIN_OUT = 21_000_000n;

const EXACT_IN_SINGLE_TUPLE = {
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

function build(over: Partial<Parameters<typeof buildUniversalRouterSwapCalldata>[0]> = {}) {
  return buildUniversalRouterSwapCalldata({
    poolKey: POOL_KEY,
    zeroForOne: false, // USDC (currency1) in → EURC (currency0) out
    amountInRaw: AMOUNT_IN,
    amountOutMinimum: MIN_OUT,
    nowSeconds: NOW,
    ...over,
  });
}

function decodeExecute(data: `0x${string}`) {
  const { args } = decodeFunctionData({ abi: UNIVERSAL_ROUTER_EXECUTE_ABI, data });
  const [commands, inputs, deadline] = args;
  return { commands, inputs, deadline };
}

void describe("buildUniversalRouterSwapCalldata — layout", () => {
  void it("targets the UniversalRouter with the execute(bytes,bytes[],uint256) selector", () => {
    const swap = build();
    assert.equal(swap.to, UNIVERSAL_ROUTER);
    const selector = toFunctionSelector("execute(bytes,bytes[],uint256)");
    // Byte-level pin: the deployed router's 3-arg execute entrypoint.
    assert.equal(selector, "0x3593564c");
    assert.ok(swap.data.startsWith(selector));
  });

  void it("encodes exactly one V4_SWAP (0x10) command with one input", () => {
    const { commands, inputs } = decodeExecute(build().data);
    assert.equal(commands, "0x10");
    assert.equal(UR_COMMAND_V4_SWAP, 0x10);
    assert.equal(inputs.length, 1);
  });

  void it("carries the deadline = now + SWAP_DEADLINE_SECONDS (bounded, in the calldata)", () => {
    const swap = build();
    const { deadline } = decodeExecute(swap.data);
    assert.equal(deadline, BigInt(NOW + SWAP_DEADLINE_SECONDS));
    assert.equal(swap.deadline, deadline.toString());
    assert.equal(SWAP_DEADLINE_SECONDS, 600);
  });

  void it("action bytes are SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL in order", () => {
    const { inputs } = decodeExecute(build().data);
    const [actions, params] = decodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes[]" }],
      inputs[0],
    );
    assert.equal(actions, "0x060c0f");
    assert.equal(V4_ACTION_SWAP_EXACT_IN_SINGLE, 0x06);
    assert.equal(V4_ACTION_SETTLE_ALL, 0x0c);
    assert.equal(V4_ACTION_TAKE_ALL, 0x0f);
    assert.equal(params.length, 3);
  });

  void it("SWAP_EXACT_IN_SINGLE params round-trip: poolKey, direction, amountIn, min-out", () => {
    const { inputs } = decodeExecute(build().data);
    const [, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
    const [decoded] = decodeAbiParameters([EXACT_IN_SINGLE_TUPLE], params[0]);
    assert.equal(decoded.poolKey.currency0.toLowerCase(), EURC.toLowerCase());
    assert.equal(decoded.poolKey.currency1.toLowerCase(), USDC.toLowerCase());
    assert.equal(decoded.poolKey.fee, 500);
    assert.equal(decoded.poolKey.tickSpacing, 10);
    assert.equal(decoded.poolKey.hooks, ZERO);
    assert.equal(decoded.zeroForOne, false);
    assert.equal(decoded.amountIn, AMOUNT_IN);
    // The slippage floor is INSIDE the signed transaction.
    assert.equal(decoded.amountOutMinimum, MIN_OUT);
    assert.equal(decoded.hookData, "0x");
  });

  void it("SETTLE_ALL caps at amountIn on the input currency; TAKE_ALL floors at min-out on the output", () => {
    const { inputs } = decodeExecute(build().data);
    const [, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
    // zeroForOne=false → input is currency1 (USDC), output currency0 (EURC).
    const [settleCurrency, settleMax] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      params[1],
    );
    assert.equal(settleCurrency.toLowerCase(), USDC.toLowerCase());
    assert.equal(settleMax, AMOUNT_IN);
    const [takeCurrency, takeMin] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      params[2],
    );
    assert.equal(takeCurrency.toLowerCase(), EURC.toLowerCase());
    assert.equal(takeMin, MIN_OUT);
  });

  void it("zeroForOne=true flips input/output currencies", () => {
    const { inputs } = decodeExecute(build({ zeroForOne: true }).data);
    const [, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], inputs[0]);
    const [settleCurrency] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      params[1],
    );
    const [takeCurrency] = decodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      params[2],
    );
    assert.equal(settleCurrency.toLowerCase(), EURC.toLowerCase());
    assert.equal(takeCurrency.toLowerCase(), USDC.toLowerCase());
  });

  void it("ERC-20 input carries no value; native input carries amountIn as value", () => {
    assert.equal(build().value, "0");
    const nativeKey: PoolKey = { ...POOL_KEY, currency0: ZERO };
    const native = build({ poolKey: nativeKey, zeroForOne: true });
    assert.equal(native.value, AMOUNT_IN.toString());
  });

  void it("fails closed on missing/degenerate protection or overflow amounts", () => {
    assert.throws(() => build({ amountOutMinimum: 0n }), /amountOutMinimum must be positive/);
    assert.throws(() => build({ amountInRaw: 0n }), /amountInRaw must be positive/);
    assert.throws(() => build({ amountInRaw: 1n << 128n }), /exceeds uint128/);
    assert.throws(() => build({ amountOutMinimum: 1n << 128n }), /exceeds uint128/);
  });
});

void describe("minOutFromQuote", () => {
  void it("applies bps against a 10000 denominator", () => {
    assert.equal(minOutFromQuote(10_000n, 50), 9_950n);
    assert.equal(minOutFromQuote(10_000n, 0), 10_000n);
    assert.equal(minOutFromQuote(10_000n, 500), 9_500n);
  });

  void it("rejects out-of-range bps", () => {
    assert.throws(() => minOutFromQuote(10_000n, -1));
    assert.throws(() => minOutFromQuote(10_000n, 10_000));
    assert.throws(() => minOutFromQuote(10_000n, 0.5));
  });
});

function state(over: Partial<SwapAllowanceState> = {}): SwapAllowanceState {
  return { erc20Allowance: 0n, permit2Allowance: 0n, permit2Expiration: 0, ...over };
}

const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

void describe("planSwapApprovals — bounded per-trade approvals (C-022)", () => {
  void it("cold wallet: ERC20→Permit2 then Permit2→router, both capped to the trade", () => {
    const calls = planSwapApprovals({
      token: USDC,
      requiredRaw: AMOUNT_IN,
      state: state(),
      nowSeconds: NOW,
    });
    assert.equal(calls.length, 2);

    const [erc20Call, permit2Call] = calls;
    assert.equal(erc20Call.to, USDC);
    assert.equal(erc20Call.abiFunctionSignature, "approve(address,uint256)");
    assert.equal(erc20Call.abiParameters[0], PERMIT2);
    assert.equal(BigInt(erc20Call.abiParameters[1]), AMOUNT_IN);
    assert.ok(BigInt(erc20Call.abiParameters[1]) < MAX_UINT256);

    assert.equal(permit2Call.to, PERMIT2);
    assert.equal(permit2Call.abiFunctionSignature, "approve(address,address,uint160,uint48)");
    assert.equal(permit2Call.abiParameters[0], USDC);
    assert.equal(permit2Call.abiParameters[1], UNIVERSAL_ROUTER);
    assert.equal(BigInt(permit2Call.abiParameters[2]), AMOUNT_IN);
    assert.ok(BigInt(permit2Call.abiParameters[2]) < MAX_UINT160);
    assert.equal(Number(permit2Call.abiParameters[3]), NOW + PERMIT2_EXPIRATION_SECONDS);
  });

  void it("the raw tx encoding and the Circle ABI encoding describe the same call", () => {
    const calls = planSwapApprovals({
      token: USDC,
      requiredRaw: AMOUNT_IN,
      state: state(),
      nowSeconds: NOW,
    });
    const permit2Call = calls[1];
    const decoded = decodeFunctionData({ abi: PERMIT2_APPROVE_ABI, data: permit2Call.data });
    assert.equal(decoded.functionName, "approve");
    assert.equal(decoded.args[0], USDC);
    assert.equal(decoded.args[1], UNIVERSAL_ROUTER);
    assert.equal(decoded.args[2], AMOUNT_IN);
    assert.equal(decoded.args[3], NOW + PERMIT2_EXPIRATION_SECONDS);
  });

  void it("skips approvals already covering the trade with a fresh expiry", () => {
    const calls = planSwapApprovals({
      token: USDC,
      requiredRaw: AMOUNT_IN,
      state: state({
        erc20Allowance: AMOUNT_IN,
        permit2Allowance: AMOUNT_IN,
        permit2Expiration: NOW + PERMIT2_EXPIRATION_SECONDS,
      }),
      nowSeconds: NOW,
    });
    assert.equal(calls.length, 0);
  });

  void it("re-issues a Permit2 grant that expires inside the validity buffer", () => {
    const calls = planSwapApprovals({
      token: USDC,
      requiredRaw: AMOUNT_IN,
      state: state({
        erc20Allowance: AMOUNT_IN,
        permit2Allowance: AMOUNT_IN,
        permit2Expiration: NOW + PERMIT2_VALIDITY_BUFFER_SECONDS - 1,
      }),
      nowSeconds: NOW,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, PERMIT2);
  });

  void it("rejects a non-positive or uint160-overflowing trade size", () => {
    assert.throws(() =>
      planSwapApprovals({ token: USDC, requiredRaw: 0n, state: state(), nowSeconds: NOW }),
    );
    assert.throws(() =>
      planSwapApprovals({
        token: USDC,
        requiredRaw: 1n << 160n,
        state: state(),
        nowSeconds: NOW,
      }),
    );
  });
});
