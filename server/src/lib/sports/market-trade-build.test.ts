import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertUsdcCollateral, marketTradeSpendUsd } from "./market-trade-build.ts";

describe("marketTradeSpendUsd (C-019 market-trade cap leg)", () => {
  it("prices a buy at its exact USDC amount (no feed involved)", () => {
    assert.equal(marketTradeSpendUsd("buy", 1_000_000n), 1);
    assert.equal(marketTradeSpendUsd("buy", 12_345_678n), 12.345678);
  });

  it("returns null for a sell — exits return USDC and touch no cap", () => {
    assert.equal(marketTradeSpendUsd("sell", 5_000_000n), null);
  });
});

describe("assertUsdcCollateral (C-004 platform-currency guard)", () => {
  const CANONICAL_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

  it("accepts the canonical Base USDC address, case-insensitively", () => {
    assert.doesNotThrow(() => {
      assertUsdcCollateral(8453, CANONICAL_USDC);
    });
    assert.doesNotThrow(() => {
      assertUsdcCollateral(8453, CANONICAL_USDC.toLowerCase() as `0x${string}`);
    });
  });

  it("rejects any other collateral token", () => {
    // EURC on Base — 6dp stablecoin, but not the platform currency.
    assert.throws(
      () => {
        assertUsdcCollateral(8453, "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42");
      },
      /canonical USDC/,
    );
  });
});
