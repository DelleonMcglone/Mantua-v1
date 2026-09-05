/**
 * B7-004 — market-pool liquidity addressing.
 *
 * Two behaviors pinned here:
 *  1. The gated state: with no Dynamic Market deployment configured
 *     (MARKETS_BY_CHAIN / MARKETS_PERIPHERY_BY_CHAIN / DYNAMIC_MARKET_BY_CHAIN
 *     empty — today's reality), every market-pool liquidity resolution
 *     throws the typed MarketLiquidityGatedError BEFORE any RPC, so the
 *     routes can surface a structured `gated: true` response. A liquidity
 *     action succeeding against an undeployed market pool is a named B7
 *     failure condition.
 *  2. DM-112 routing: the key-addressed add builder resolves `to` through
 *     getV4StackForHook — a key carrying the Dynamic Market hook routes to
 *     the DM stack's PositionManager, and a no-hook key still routes to the
 *     canonical stack. Pinned by injecting a fake deployment into the
 *     per-chain registries (restored in finally).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { BASE_CHAIN_ID } = await import("./chains.ts");
const {
  MarketLiquidityGatedError,
  assertMarketPoolsDeployed,
  resolveMarketPoolLiquidity,
} = await import("./market-pool-liquidity.ts");
const { MARKETS_PERIPHERY_BY_CHAIN } = await import("./markets-contracts.ts");
const {
  DYNAMIC_MARKET_BY_CHAIN,
  DYNAMIC_FEE_FLAG,
  getV4PositionManager,
  getV4StackForHook,
} = await import("./v4-contracts.ts");
const { buildAddLiquidityCalldataForKey } = await import("./v4-add-liquidity.ts");

const DM_HOOK = "0x00000000000000000000000000000000000ac0de" as const;
const DM_POOL_MANAGER = "0x1111111111111111111111111111111111111111" as const;
const DM_POSITION_MANAGER = "0x2222222222222222222222222222222222222222" as const;

/** 1:1 price — 2^96 as sqrtPriceX96. */
const SQRT_PRICE_1_1 = 2n ** 96n;

function withFakeDmDeployment<T>(fn: () => T): T {
  DYNAMIC_MARKET_BY_CHAIN[BASE_CHAIN_ID] = {
    poolManager: DM_POOL_MANAGER,
    registry: "0x3333333333333333333333333333333333333333",
    hook: DM_HOOK,
    operator: "0x4444444444444444444444444444444444444444",
    keeper: "0x5555555555555555555555555555555555555555",
  };
  MARKETS_PERIPHERY_BY_CHAIN[BASE_CHAIN_ID] = {
    poolSwapTest: null,
    poolModifyLiquidityTest: null,
    stateView: "0x6666666666666666666666666666666666666666",
    quoter: "0x7777777777777777777777777777777777777777",
    positionDescriptor: null,
    positionManager: DM_POSITION_MANAGER,
  };
  try {
    return fn();
  } finally {
    // BASE_CHAIN_ID is the registries' only key — restore the empty
    // pre-deployment state exactly.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test-only registry reset; the key is a compile-time constant.
    delete DYNAMIC_MARKET_BY_CHAIN[BASE_CHAIN_ID];
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- test-only registry reset; the key is a compile-time constant.
    delete MARKETS_PERIPHERY_BY_CHAIN[BASE_CHAIN_ID];
  }
}

void describe("market-pool liquidity gating (B7-004)", () => {
  void it("assertMarketPoolsDeployed throws the typed gated error while the DM stack is absent", () => {
    assert.throws(
      () => assertMarketPoolsDeployed(BASE_CHAIN_ID),
      (err: unknown) => {
        assert.ok(err instanceof MarketLiquidityGatedError);
        assert.equal(err.code, "MARKET_POOLS_NOT_DEPLOYED");
        assert.match(err.message, /not live/i);
        return true;
      },
    );
  });

  void it("resolveMarketPoolLiquidity surfaces the gated state before any RPC", async () => {
    await assert.rejects(
      resolveMarketPoolLiquidity({
        providerEventId: "401671789",
        outcomeIndex: 0,
        chainId: BASE_CHAIN_ID,
      }),
      (err: unknown) => err instanceof MarketLiquidityGatedError,
    );
  });
});

void describe("key-addressed add builder routes per DM-112", () => {
  const baseKey = {
    // Arbitrary sorted ERC-20 pair — the builder doesn't consult the
    // token registry on the key-addressed path.
    currency0: "0x1000000000000000000000000000000000000001" as const,
    currency1: "0x2000000000000000000000000000000000000002" as const,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: 60,
    hooks: DM_HOOK,
  };
  const amounts = {
    amount0Raw: 1_000_000n,
    amount1Raw: 1_000_000n,
    sqrtPriceX96: SQRT_PRICE_1_1,
    slippageBps: 50,
    owner: "0x9999999999999999999999999999999999999999" as const,
    deadlineSeconds: 1_900_000_000,
    chainId: BASE_CHAIN_ID,
  };

  void it("a Dynamic Market hook key routes to the DM PositionManager once deployed", () => {
    withFakeDmDeployment(() => {
      const stack = getV4StackForHook(DM_HOOK, BASE_CHAIN_ID);
      assert.equal(stack.positionManager, DM_POSITION_MANAGER);
      const built = buildAddLiquidityCalldataForKey({ key: baseKey, ...amounts });
      assert.equal(built.to, DM_POSITION_MANAGER);
      assert.ok(BigInt(built.liquidity) > 0n);
      assert.equal(built.currency0, baseKey.currency0);
      assert.equal(built.currency1, baseKey.currency1);
    });
  });

  void it("a no-hook key still routes to the canonical PositionManager", () => {
    withFakeDmDeployment(() => {
      const built = buildAddLiquidityCalldataForKey({
        key: { ...baseKey, hooks: "0x0000000000000000000000000000000000000000", fee: 3000 },
        ...amounts,
      });
      assert.equal(built.to, getV4PositionManager(BASE_CHAIN_ID));
    });
  });
});
