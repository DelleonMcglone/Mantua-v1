import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planMarketPool, poolIdOf } from "./market-pool.ts";
import { sqrtPriceX96ToProbability } from "../probability.ts";
import { DYNAMIC_FEE_FLAG } from "../v4-contracts.ts";

const HOOK = "0xbb5D42DC40128fa681882cA49f9A74d50D15E8c0" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const YES_LOW = "0x1111111111111111111111111111111111111111" as const;
const YES_HIGH = "0xffffffff11111111111111111111111111111111" as const;

void describe("planMarketPool (B1-009)", () => {
  void it("sorts currencies by address and flags the ordering", () => {
    const low = planMarketPool(YES_LOW, USDC, HOOK, 0.6);
    assert.equal(low.yesIsToken0, true);
    assert.equal(low.key.currency0, YES_LOW);

    const high = planMarketPool(YES_HIGH, USDC, HOOK, 0.6);
    assert.equal(high.yesIsToken0, false);
    assert.equal(high.key.currency0, USDC);
  });

  void it("round-trips the opening probability through the sqrt price, BOTH orderings", () => {
    // The footgun this guards: a reversed ordering opens the pool at 1/p.
    for (const yes of [YES_LOW, YES_HIGH]) {
      const plan = planMarketPool(yes, USDC, HOOK, 0.62);
      const back = sqrtPriceX96ToProbability(plan.sqrtPriceX96, plan.yesIsToken0);
      assert.ok(Math.abs(back - 0.62) < 1e-6, `${yes}: got ${String(back)}`);
    }
  });

  void it("uses the dynamic-fee sentinel, never a static tier", () => {
    assert.equal(planMarketPool(YES_LOW, USDC, HOOK, 0.5).key.fee, DYNAMIC_FEE_FLAG);
  });

  void it("poolId is deterministic and ordering-sensitive", () => {
    const a = planMarketPool(YES_LOW, USDC, HOOK, 0.5);
    const b = planMarketPool(YES_LOW, USDC, HOOK, 0.9);
    assert.equal(a.poolId, b.poolId, "price does not change identity");
    assert.equal(poolIdOf(a.key), a.poolId);
    const other = planMarketPool(YES_HIGH, USDC, HOOK, 0.5);
    assert.notEqual(a.poolId, other.poolId);
  });
});
