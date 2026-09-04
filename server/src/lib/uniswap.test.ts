import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { UnreadableQuoteError, quoteSpendLeg } from "./uniswap.ts";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

/** Minimal shape that passes the Trading API quote schema (loose objects). */
function quote(inputToken: string, inputAmount: string): unknown {
  return {
    requestId: "test-request",
    routing: "DUTCH_V2",
    quote: {
      chainId: 8453,
      swapper: "0x1111111254eeb25477b68fb85ed929f73a960582",
      tradeType: "EXACT_IN",
      quoteId: "test-quote",
      input: { token: inputToken, amount: inputAmount },
      output: { token: WETH, amount: "1000000000000000", recipient: WETH },
    },
  };
}

describe("quoteSpendLeg (C-019 server-side spend pricing)", () => {
  it("reads the spend (symbol + raw base units) from the quote's input leg", () => {
    const spend = quoteSpendLeg(quote(USDC, "5000000"));
    assert.deepEqual(spend, { symbol: "USDC", amountRaw: 5_000_000n });
  });

  it("resolves a case-insensitive checksummed input token address", () => {
    const spend = quoteSpendLeg(quote(USDC.toLowerCase(), "1000000"));
    assert.equal(spend.symbol, "USDC");
  });

  it("rejects quotes whose input token is not in the registry", () => {
    assert.throws(
      () => quoteSpendLeg(quote("0xdead000000000000000000000000000000000001", "1")),
      UnreadableQuoteError,
    );
  });

  it("rejects quotes that do not match the Trading API shape", () => {
    assert.throws(() => quoteSpendLeg({ nonsense: true }), UnreadableQuoteError);
  });

  it("rejects non-integer base-unit amounts", () => {
    assert.throws(() => quoteSpendLeg(quote(USDC, "1.5")), UnreadableQuoteError);
  });

  it("rejects zero and negative spend amounts", () => {
    assert.throws(() => quoteSpendLeg(quote(USDC, "0")), UnreadableQuoteError);
    assert.throws(() => quoteSpendLeg(quote(USDC, "-1000000")), UnreadableQuoteError);
  });
});
