import { Router, type Request, type Response } from "express";
import { parseAbi } from "viem";
import { logger } from "../lib/logger.ts";
import { getRpcClient } from "../lib/rpc-client.ts";
import { BASE_CHAIN_ID } from "../lib/chains.ts";
import { getTokens } from "../lib/tokens.ts";
import {
  DYNAMIC_FEE_FLAG,
  HOOK_DEPLOYMENTS,
  getHookAddress,
  getV4Addresses,
} from "../lib/v4-contracts.ts";
import {
  ERC20_APPROVE_ABI,
  LP_ROUTER_ABI,
  POOL_MANAGER_INIT_ABI,
  STATE_VIEW_ABI,
} from "../lib/markets-contracts.ts";
import { computePoolId } from "../lib/pool-id.ts";
import { marketSignerWallet } from "../lib/sports/markets-onchain.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

export const adminSpPoolRouter = Router();

/** Q96 — sqrtPriceX96 for an exact 1:1 price (both tokens 6 decimals). */
const SQRT_PRICE_1_1 = 79228162514264337593543950336n;
/** Full usable v4 range at tick spacing 10. */
const FULL_RANGE_TICK = 887_270;
const TICK_SPACING = 10;
/** Don't re-add once the pool holds at least this much liquidity. */
const LIQUIDITY_FLOOR = 1_000_000n;

const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

/**
 * GET /api/cron/sp-pool-bootstrap — one-shot (idempotent) bootstrap for
 * Base's Stable Protection USDC/EURC market.
 *
 * The hook models the pair as 1:1 parity stables and hard-halts past 5%
 * deviation — and a halted pool can never be swapped back. This opens the
 * pair's pool at tick spacing 10, priced at 1.00 where the hook is
 * healthy, and seeds it full-range from the market signer's USDC/EURC
 * balances. Quote-side tier resolution skips any dead pool (see
 * resolveInitializedFee), so the app converges on this one.
 *
 * Manual-trigger only (cron-secret guarded, not scheduled). Re-running is
 * safe: initialize is skipped when priced, seeding when liquid.
 */
adminSpPoolRouter.get(
  "/api/cron/sp-pool-bootstrap",
  requireCronSecret,
  async (_req: Request, res: Response) => {
    const chainId = BASE_CHAIN_ID;
    try {
      const wallet = marketSignerWallet(chainId);
      if (!wallet) {
        res.status(503).json({ error: "No authorised signer for Base." });
        return;
      }
      const client = getRpcClient(chainId);
      const hook = getHookAddress("stable-protection", chainId);
      if (!hook) {
        res.status(503).json({ error: "Stable Protection is not deployed on Base." });
        return;
      }
      const stack = getV4Addresses(chainId);
      // Any ModifyLiquidity router bound to the canonical PoolManager works.
      const lpRouter = HOOK_DEPLOYMENTS[chainId]["dynamic-fee"].poolModifyLiquidityTest;
      if (!lpRouter) {
        res.status(503).json({ error: "No liquidity router configured for Base." });
        return;
      }
      const tokens = getTokens(chainId);
      const usdc = tokens.USDC;
      const eurc = tokens.EURC;
      const [c0, c1] =
        usdc.address.toLowerCase() < eurc.address.toLowerCase()
          ? [usdc.address, eurc.address]
          : [eurc.address, usdc.address];
      const key = {
        currency0: c0,
        currency1: c1,
        fee: DYNAMIC_FEE_FLAG,
        tickSpacing: TICK_SPACING,
        hooks: hook,
      };
      const poolId = computePoolId(key);

      const summary: Record<string, unknown> = { poolId, key };

      const [sqrtPriceX96] = await client.readContract({
        address: stack.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [poolId],
      });
      if (sqrtPriceX96 === 0n) {
        const { request } = await client.simulateContract({
          account: wallet.account,
          address: stack.poolManager,
          abi: POOL_MANAGER_INIT_ABI,
          functionName: "initialize",
          args: [key, SQRT_PRICE_1_1],
        });
        const txHash = await wallet.writeContract(request);
        await client.waitForTransactionReceipt({ hash: txHash });
        summary["initialized"] = txHash;
      } else {
        summary["initialized"] = "already";
      }

      const liquidity = await client.readContract({
        address: stack.stateView,
        abi: STATE_VIEW_ABI,
        functionName: "getLiquidity",
        args: [poolId],
      });
      summary["liquidityBefore"] = liquidity.toString();
      if (liquidity >= LIQUIDITY_FLOOR) {
        res.json({ ok: true, seeded: false, reason: "already liquid", ...summary });
        return;
      }

      const signer = wallet.account.address;
      const balances = await Promise.all(
        [usdc.address, eurc.address].map((t) =>
          client.readContract({
            address: t,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [signer],
          }),
        ),
      );
      const [usdcBal, eurcBal] = balances as [bigint, bigint];
      summary["usdcBal"] = usdcBal.toString();
      summary["eurcBal"] = eurcBal.toString();
      // Full-range at 1:1 needs ≈ L of each token; 90% leaves gas-side slack.
      const liquidityDelta = ((usdcBal < eurcBal ? usdcBal : eurcBal) * 9n) / 10n;
      if (liquidityDelta === 0n) {
        res.json({
          ok: false,
          seeded: false,
          reason: `Signer ${signer} needs both USDC and EURC on Base.`,
          ...summary,
        });
        return;
      }

      for (const token of [usdc.address, eurc.address]) {
        const { request } = await client.simulateContract({
          account: wallet.account,
          address: token,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [lpRouter, liquidityDelta * 2n],
        });
        const txHash = await wallet.writeContract(request);
        await client.waitForTransactionReceipt({ hash: txHash });
      }
      const { request: lpReq } = await client.simulateContract({
        account: wallet.account,
        address: lpRouter,
        abi: LP_ROUTER_ABI,
        functionName: "modifyLiquidity",
        args: [
          key,
          {
            tickLower: -FULL_RANGE_TICK,
            tickUpper: FULL_RANGE_TICK,
            liquidityDelta,
            salt: `0x${"00".repeat(32)}`,
          },
          "0x",
        ],
      });
      const lpTx = await wallet.writeContract(lpReq);
      await client.waitForTransactionReceipt({ hash: lpTx });
      summary["seedTx"] = lpTx;
      summary["liquidityAdded"] = liquidityDelta.toString();
      res.json({ ok: true, seeded: true, ...summary });
    } catch (err) {
      logger.error({ err }, "sp-pool-bootstrap failed");
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 400) : String(err),
      });
    }
  },
);
