import { Router, type Request, type Response } from "express";
import type { Log } from "viem";
import { z } from "zod";
import { db } from "../db/client.ts";
import { readPolicy, type AgentPolicyView } from "../lib/agent/policy.ts";
import { BASE_CHAIN_ID, isSupportedChainId, type SupportedChainId } from "../lib/chains.ts";
import { ComboLegMismatchError, recordComboFill } from "../lib/combos/combo-fill.ts";
import { readComboOnChain, type ComboOnChain } from "../lib/combos/combo-market.ts";
import { comboPolicyGate } from "../lib/combos/combo-policy.ts";
import { priceCombo } from "../lib/combos/combo-pricing.ts";
import { platformLimits } from "../lib/combos/combo-quote.ts";
import {
  latestPricesBps,
  legCandidatesFrom,
  readLegRows,
  winnersByMarket,
  type LegRef,
  type LegRow,
} from "../lib/combos/combo-read.ts";
import { swapAmountsFromLogs } from "../lib/combos/combo-receipt.ts";
import { validateLegs, type LegCandidate } from "../lib/combos/combo-rules.ts";
import type { LegResult } from "../lib/combos/combo-settlement.ts";
import { openExposureUsd } from "../lib/combos/combo-store.ts";
import { ComboDeadError, buildComboTrade, legResults } from "../lib/combos/combo-trade.ts";
import { MAX_SLIPPAGE_BPS } from "../lib/constants.ts";
import { SafetyError } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";
import { MARKETS_BY_CHAIN, MARKETS_PERIPHERY_BY_CHAIN } from "../lib/markets-contracts.ts";
import { counters } from "../lib/metrics.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { getRpcClient } from "../lib/rpc-client.ts";
import { guardSpend, type SpendGuardIo } from "../lib/spending-cap.ts";
import {
  MarketClosedError,
  MarketDataOutageError,
  MarketsNotDeployedError,
  NoMarketError,
} from "../lib/sports/market-trade-build.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { legsSchema } from "./combos.ts";

/**
 * Task 072 / CB-005 — the combo's single transaction. `/calldata` is one
 * swap on the combo pool behind the leg rules and the policy gate (with
 * the payout the legs imply), cap-checked and recorded ONCE for the whole
 * stake (C-019, never per leg); `/fills` verifies the receipt on chain —
 * success, our router as the target, the caller's own wallet as the
 * sender — and takes the amounts and the traded market from the receipt's
 * transfer logs, never from the client. The legs the client reports must
 * recompute to the market id, which is the commitment over exactly them.
 */

const hex32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const chainSchema = z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional();
const calldataSchema = z.object({
  marketId: hex32,
  legs: legsSchema.min(2),
  direction: z.enum(["buy", "sell"]).default("buy"),
  amountRaw: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => BigInt(v) > 0n && BigInt(v) <= 100_000_000_000n, {
      message: "amount out of range",
    }),
  chainId: chainSchema,
  slippageBps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).optional(),
});
const fillSchema = z.object({
  txHash: hex32,
  marketId: hex32,
  legs: legsSchema.min(2),
  direction: z.enum(["buy", "sell"]),
  chainId: chainSchema,
});

export interface ComboTradeContext {
  rows: LegRow[];
  candidates: LegCandidate[];
  legs: { row: LegRow; result: LegResult }[];
  policy: AgentPolicyView;
  openExposureUsd: number;
}
export interface VerifiedReceipt {
  status: string;
  to: string | null;
  from: string;
  logs: readonly Log[];
}
export interface ComboTradeDeps {
  build: typeof buildComboTrade;
  spendIo?: SpendGuardIo;
  userIdOf: (privyUserId: string) => Promise<string | null>;
  context: (
    userId: string,
    legs: LegRef[],
    chainId: SupportedChainId,
  ) => Promise<ComboTradeContext>;
  receipt: (chainId: SupportedChainId, txHash: `0x${string}`) => Promise<VerifiedReceipt>;
  swapRouterFor: (chainId: SupportedChainId) => `0x${string}` | null;
  /** The combo market's chain view and the chain's USDC; null when absent. */
  market: (
    marketId: `0x${string}`,
    chainId: SupportedChainId,
  ) => Promise<{ onChain: ComboOnChain; usdc: `0x${string}` } | null>;
  record: typeof recordComboFill;
}

async function defaultContext(
  userId: string,
  refs: LegRef[],
  chainId: SupportedChainId,
): Promise<ComboTradeContext> {
  const rows = await readLegRows(db, refs, chainId);
  const ids = rows.map((r) => r.marketId);
  const [winners, policy, exposure, prices] = await Promise.all([
    winnersByMarket(db, ids),
    readPolicy(db, userId),
    openExposureUsd(db, userId),
    latestPricesBps(db, ids),
  ]);
  return {
    rows,
    candidates: legCandidatesFrom(rows, prices, () => false),
    legs: legResults(rows, winners),
    policy,
    openExposureUsd: exposure,
  };
}
async function defaultReceipt(
  chainId: SupportedChainId,
  txHash: `0x${string}`,
): Promise<VerifiedReceipt> {
  const client = getRpcClient(chainId);
  const [receipt, tx] = await Promise.all([
    client.getTransactionReceipt({ hash: txHash }),
    client.getTransaction({ hash: txHash }),
  ]);
  return { status: receipt.status, to: tx.to ?? null, from: tx.from, logs: receipt.logs };
}
async function defaultMarket(marketId: `0x${string}`, chainId: SupportedChainId) {
  const usdc = MARKETS_BY_CHAIN[chainId]?.collateral;
  const onChain = await readComboOnChain(marketId, chainId);
  return usdc && onChain ? { onChain, usdc } : null;
}

function respondTradeError(err: unknown, res: Response): void {
  if (err instanceof SafetyError)
    res.status(400).json({ error: err.message, code: err.code, details: err.details });
  else if (err instanceof MarketsNotDeployedError)
    res.status(503).json({ error: err.message, code: "MARKETS_NOT_DEPLOYED" });
  else if (err instanceof NoMarketError)
    res.status(404).json({ error: "Combo market not created yet", code: "NO_MARKET" });
  else if (err instanceof MarketClosedError)
    res.status(409).json({ error: err.message, code: "BETTING_CLOSED" });
  else if (err instanceof ComboDeadError)
    res.status(409).json({ error: err.message, code: "COMBO_DEAD" });
  else if (err instanceof MarketDataOutageError)
    res.status(503).json({ error: err.message, code: "TRADING_HALTED" });
  else {
    logger.warn({ err }, "combos: trade failed");
    res.status(502).json({ error: "Couldn't build this combo trade", code: "QUOTE_FAILED" });
  }
}

/** The rules and the policy gate on the commit path, with the payout the legs' prices imply. */
function gateBuy(
  ctx: ComboTradeContext,
  amountRaw: bigint,
  nowMs: number,
): { code: string; error: string; details: unknown } | null {
  const platform = platformLimits();
  const violations = validateLegs(ctx.candidates, {
    maxLegs: Math.min(platform.maxLegs, ctx.policy.combo.maxLegs),
    allowedLeagues: ctx.policy.allowedLeagues,
    nowSeconds: Math.floor(nowMs / 1000),
  });
  if (violations.length > 0) {
    return {
      code: "COMBO_RULES",
      error: violations.map((v) => v.detail).join("; "),
      details: violations,
    };
  }
  const est = priceCombo({
    stakeRaw: amountRaw,
    legs: ctx.candidates.map((c) => ({ marketId: c.marketId, priceBps: c.priceBps ?? 10_000 })),
    pool: null,
    playoffs: false,
  });
  const gate = comboPolicyGate(ctx.policy, {
    legs: ctx.rows.length,
    stakeUsd: Number(amountRaw) / 1e6,
    payoutUsd: Number(est.potentialPayoutRaw) / 1e6,
    openExposureUsd: ctx.openExposureUsd,
    leagues: ctx.rows.map((r) => r.league),
    platform,
  });
  return gate.ok
    ? null
    : { code: "COMBO_POLICY", error: gate.reasons.join("; "), details: gate.reasons };
}

export function createComboTradeRouter(overrides: Partial<ComboTradeDeps> = {}): Router {
  const deps: ComboTradeDeps = {
    build: overrides.build ?? buildComboTrade,
    ...(overrides.spendIo ? { spendIo: overrides.spendIo } : {}),
    userIdOf: overrides.userIdOf ?? ((privyUserId) => resolveUserId(db, privyUserId)),
    context: overrides.context ?? defaultContext,
    receipt: overrides.receipt ?? defaultReceipt,
    swapRouterFor:
      overrides.swapRouterFor ?? ((c) => MARKETS_PERIPHERY_BY_CHAIN[c]?.poolSwapTest ?? null),
    market: overrides.market ?? defaultMarket,
    record: overrides.record ?? recordComboFill,
  };
  const router = Router();

  router.post(
    "/api/combos/calldata",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const parsed = calldataSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid combo trade",
          code: "BAD_REQUEST",
          details: parsed.error.issues,
        });
        return;
      }
      const wallet = getRequestContext(req).walletAddress;
      const userId = req.privyUserId ? await deps.userIdOf(req.privyUserId) : null;
      if (!wallet || !userId) {
        res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
        return;
      }
      const { direction } = parsed.data;
      const chainId = parsed.data.chainId ?? BASE_CHAIN_ID;
      const amountRaw = BigInt(parsed.data.amountRaw);
      const marketId = parsed.data.marketId.toLowerCase() as `0x${string}`;
      try {
        const ctx = await deps.context(userId, parsed.data.legs, chainId);
        if (direction === "buy") {
          const refused = gateBuy(ctx, amountRaw, Date.now());
          if (refused) {
            res.status(400).json(refused);
            return;
          }
        }
        const args = {
          marketId,
          direction,
          amountRaw,
          chainId,
          legs: ctx.legs,
          ...(parsed.data.slippageBps !== undefined
            ? { slippageBps: parsed.data.slippageBps }
            : {}),
        };
        // C-019 — one check, one intent record, for the whole stake; sells touch no cap.
        const built =
          direction === "buy"
            ? await guardSpend(
                () => Promise.resolve(Number(amountRaw) / 1e6),
                wallet,
                () => deps.build(args),
                deps.spendIo,
              )
            : await deps.build(args);
        counters.inc("combo.calldata.ok");
        res.json(built);
      } catch (err) {
        counters.inc("combo.calldata.failed");
        respondTradeError(err, res);
      }
    },
  );

  router.post(
    "/api/combos/fills",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const parsed = fillSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid fill", code: "BAD_REQUEST" });
        return;
      }
      const wallet = getRequestContext(req).walletAddress;
      const userId = req.privyUserId ? await deps.userIdOf(req.privyUserId) : null;
      if (!wallet || !userId) {
        res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
        return;
      }
      const chainId = parsed.data.chainId ?? BASE_CHAIN_ID;
      const swapRouter = deps.swapRouterFor(chainId);
      if (!swapRouter) {
        res.status(400).json({ error: "Markets not deployed on this chain", code: "BAD_CHAIN" });
        return;
      }
      const marketId = parsed.data.marketId.toLowerCase() as `0x${string}`;
      try {
        const tx = await deps.receipt(chainId, parsed.data.txHash as `0x${string}`);
        if (tx.status !== "success") {
          res.status(422).json({ error: "Transaction did not succeed", code: "TX_FAILED" });
          return;
        }
        if (tx.to?.toLowerCase() !== swapRouter.toLowerCase()) {
          res.status(422).json({ error: "Not a combo trade", code: "WRONG_TARGET" });
          return;
        }
        if (tx.from.toLowerCase() !== wallet.toLowerCase()) {
          res.status(403).json({
            error: "This transaction was not sent by your wallet",
            code: "WALLET_MISMATCH",
          });
          return;
        }
        const market = await deps.market(marketId, chainId);
        const amounts =
          market &&
          swapAmountsFromLogs(tx.logs, {
            yesToken: market.onChain.yesToken,
            usdc: market.usdc,
            wallet: tx.from.toLowerCase() as `0x${string}`,
            direction: parsed.data.direction,
          });
        if (!amounts) {
          res.status(422).json({
            error: "The receipt does not show a swap of this combo",
            code: "WRONG_MARKET",
          });
          return;
        }
        const outcome = await deps.record(db, {
          userId,
          walletAddress: tx.from.toLowerCase(),
          chainId,
          marketId,
          direction: parsed.data.direction,
          tokensRaw: amounts.tokensRaw,
          usdcRaw: amounts.usdcRaw,
          txHash: parsed.data.txHash.toLowerCase(),
          legs: parsed.data.legs,
          source: "user",
          mode: "user_confirmed",
        });
        counters.inc(`combo.fill.${outcome.kind}`);
        res.status(201).json({ ok: true, ...outcome });
      } catch (err) {
        if (err instanceof ComboLegMismatchError) {
          res.status(422).json({ error: err.message, code: "LEG_MISMATCH" });
          return;
        }
        logger.warn({ err, txHash: parsed.data.txHash }, "combos: fill verification failed");
        res.status(422).json({ error: "Couldn't verify the transaction", code: "VERIFY_FAILED" });
      }
    },
  );
  return router;
}

export const combosTradeRouter = createComboTradeRouter();
