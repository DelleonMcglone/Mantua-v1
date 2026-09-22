/**
 * C-024 — the decoder that prices a reverted market buy.
 *
 * Every case here is a shape a caller could put in front of the release
 * path. The rule under test is one-directional: the decoder returns an
 * amount ONLY for calldata it can prove is a collateral-funded exact-input
 * swap, and null for everything else. A false null costs a user some
 * headroom until the UTC reset; a false amount mints headroom out of
 * nothing, which is the failure the daily cap exists to prevent.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";

// The ABI module pulls in `env.ts`, which validates on import and has no
// `.env` to read in CI. Stub the required settings first, then import —
// the convention every other server test in this tree follows.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { POOL_SWAP_TEST_ABI } = await import("../v4-contracts.ts");
const { decodeRevertedBuyAmountIn } = await import("./market-trade-revert.ts");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const YES = "0x00000000000000000000000000000000000000e2" as const;
const HOOK = "0x00000000000000000000000000000000000000e3" as const;

/** YES sorts below USDC, so YES is currency0 and USDC is currency1. */
function swapCalldata(opts: { zeroForOne: boolean; amountSpecified: bigint }): `0x${string}` {
  return encodeFunctionData({
    abi: POOL_SWAP_TEST_ABI,
    functionName: "swap",
    args: [
      { currency0: YES, currency1: USDC, fee: 0, tickSpacing: 60, hooks: HOOK },
      {
        zeroForOne: opts.zeroForOne,
        amountSpecified: opts.amountSpecified,
        sqrtPriceLimitX96: 79_228_162_514_264_337_593_543_950_336n,
      },
      { takeClaims: false, settleUsingBurn: false },
      "0x",
    ],
  });
}

/** A buy spends the collateral: USDC is currency1, so not zeroForOne. */
const buy = (amountIn: bigint) => swapCalldata({ zeroForOne: false, amountSpecified: -amountIn });

void describe("C-024 — decoding a reverted market buy's input", () => {
  void it("recovers the exact USDC the wallet signed for", () => {
    assert.equal(decodeRevertedBuyAmountIn(buy(60_000_000n), USDC), 60_000_000n);
    assert.equal(decodeRevertedBuyAmountIn(buy(1n), USDC), 1n);
  });

  void it("matches the collateral regardless of address casing", () => {
    assert.equal(
      decodeRevertedBuyAmountIn(buy(25_000_000n), USDC.toLowerCase() as `0x${string}`),
      25_000_000n,
    );
  });

  void it("returns null for a sell — YES in, so no cap was ever reserved", () => {
    const sell = swapCalldata({ zeroForOne: true, amountSpecified: -80_000_000n });
    assert.equal(decodeRevertedBuyAmountIn(sell, USDC), null);
  });

  void it("returns null for exact-output, whose input a reverted tx never reveals", () => {
    const exactOutput = swapCalldata({ zeroForOne: false, amountSpecified: 60_000_000n });
    assert.equal(decodeRevertedBuyAmountIn(exactOutput, USDC), null);
    // Zero is not an exact-input amount either.
    assert.equal(
      decodeRevertedBuyAmountIn(swapCalldata({ zeroForOne: false, amountSpecified: 0n }), USDC),
      null,
    );
  });

  void it("returns null when the pool's input side is some other token", () => {
    const otherToken = "0x00000000000000000000000000000000000000c1" as const;
    assert.equal(decodeRevertedBuyAmountIn(buy(60_000_000n), otherToken), null);
  });

  void it("returns null for calldata that is not ours", () => {
    for (const input of [
      "0x",
      "0xdeadbeef",
      // A well-formed call to a different function.
      encodeFunctionData({
        abi: [
          {
            type: "function",
            name: "transfer",
            stateMutability: "nonpayable",
            inputs: [
              { type: "address", name: "to" },
              { type: "uint256", name: "amount" },
            ],
            outputs: [{ type: "bool" }],
          },
        ] as const,
        functionName: "transfer",
        args: [YES, 60_000_000n],
      }),
      // Our selector, truncated arguments.
      buy(60_000_000n).slice(0, 30),
    ] as `0x${string}`[]) {
      assert.equal(decodeRevertedBuyAmountIn(input, USDC), null, input.slice(0, 12));
    }
  });
});
