import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import {
  MarketClosedError,
  MarketDataOutageError,
  MarketsNotDeployedError,
  NoMarketError,
  buildMarketTrade,
  marketTradeSpendUsd,
  toMarketTradeQuote,
} from "../lib/sports/market-trade-build.ts";
import { MAX_SLIPPAGE_BPS } from "../lib/constants.ts";
import { isSupportedChainId } from "../lib/chains.ts";
import { SafetyError } from "../lib/errors.ts";
import {
  MarketHookRevertError,
  marketHookRevertResponse,
} from "../lib/sports/market-hook-errors.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { counters } from "../lib/metrics.ts";
import {
  checkSpendingCap,
  guardSpend,
  recordSpending,
  type SpendGuardIo,
} from "../lib/spending-cap.ts";

const bodySchema = z.object({
  providerEventId: z.string().min(1).max(32),
  /** 0 = home market, 1 = away market — whose YES the user is trading. */
  outcomeIndex: z.union([z.literal(0), z.literal(1)]),
  /** "buy" spends USDC for YES; "sell" spends YES for USDC. */
  direction: z.enum(["buy", "sell"]).default("buy"),
  /** Exact input in raw units (6dp): USDC for buys, YES tokens for sells. */
  amountRaw: z
    .string()
    .regex(/^\d+$/)
    .refine((v) => BigInt(v) > 0n && BigInt(v) <= 100_000_000_000n, {
      message: "amount out of range",
    }),
  /** Execution chain — omitted means Base (back-compat). */
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
  /** Slippage tolerance in bps — becomes the on-chain price bound in the
   *  calldata (B7-003). Hard-capped at MAX_SLIPPAGE_BPS; omitted means the
   *  platform default. */
  slippageBps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).optional(),
});

/**
 * Seams for `createMarketTradeRouter`. Production wires the real builder and
 * the real daily ledger; route tests inject a fake builder (no deployed
 * market stack needed) and a running ledger fake to assert the exact cap
 * sequence each endpoint runs.
 */
export interface MarketTradeDeps {
  /** The one builder (market-trade-build.ts) — quote and calldata alike. */
  build: typeof buildMarketTrade;
  /** Read-only cap assertion — the quote path's only ledger contact. */
  checkCap: typeof checkSpendingCap;
  /** The C-019 ledger seam for calldata issuance (check → issue → record). */
  spendIo: SpendGuardIo;
}

type TradeArgs = Parameters<typeof buildMarketTrade>[0];

/** Parse + auth the shared request shape; null when a response was sent. */
function readTradeRequest(
  req: Request,
  res: Response,
): { wallet: string; args: TradeArgs; spendUsd: number | null } | null {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid trade", code: "BAD_REQUEST", details: parsed.error.issues });
    return null;
  }
  const wallet = getRequestContext(req).walletAddress;
  if (!wallet) {
    res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
    return null;
  }
  const amountRaw = BigInt(parsed.data.amountRaw);
  const args: TradeArgs = {
    providerEventId: parsed.data.providerEventId,
    outcomeIndex: parsed.data.outcomeIndex,
    direction: parsed.data.direction,
    amountRaw,
    ...(parsed.data.chainId !== undefined ? { chainId: parsed.data.chainId } : {}),
    ...(parsed.data.slippageBps !== undefined ? { slippageBps: parsed.data.slippageBps } : {}),
  };
  // C-019 — buys spend USDC (the cap's unit of account); sells are exits and
  // touch no cap, matching the chat tool's trade_market.
  return { wallet, args, spendUsd: marketTradeSpendUsd(parsed.data.direction, amountRaw) };
}

/** Counter label for a trade failure (R-010's trade outcome breakdown). */
function tradeErrorCode(err: unknown): string {
  if (err instanceof SafetyError) return "cap_blocked";
  if (err instanceof MarketsNotDeployedError) return "not_deployed";
  if (err instanceof NoMarketError) return "no_market";
  if (err instanceof MarketClosedError) return "closed";
  if (err instanceof MarketDataOutageError) return "halted";
  if (err instanceof MarketHookRevertError) return `hook_${err.reason}`;
  return "quote_failed";
}

/** The typed failure surface both endpoints share. */
function respondTradeError(err: unknown, res: Response, wallet: string, label: string): void {
  counters.inc(`${label}.${tradeErrorCode(err)}`);
  if (err instanceof SafetyError) {
    logger.warn({ err, wallet }, `${label}: blocked by the spending cap`);
    res.status(400).json({ error: err.message, code: err.code, details: err.details });
    return;
  }
  if (err instanceof MarketsNotDeployedError) {
    // Gated state, not a failure: the market stack isn't live on this
    // chain (MARKETS_BY_CHAIN empty). Surface it as such — never an
    // opaque 502 (B7 edge case).
    res.status(503).json({ error: err.message, code: "MARKETS_NOT_DEPLOYED" });
    return;
  }
  if (err instanceof NoMarketError) {
    res.status(404).json({ error: "No market for this game yet", code: "NO_MARKET" });
    return;
  }
  if (err instanceof MarketClosedError) {
    res.status(409).json({ error: err.message, code: "BETTING_CLOSED" });
    return;
  }
  if (err instanceof MarketDataOutageError) {
    // P-012 — in-play feed outage: new buys are refused with a typed,
    // temporary error; sells (exits) never reach this branch. 503
    // because the condition clears when the feed recovers.
    res.status(503).json({ error: err.message, code: "TRADING_HALTED" });
    return;
  }
  if (err instanceof MarketHookRevertError) {
    // T-024 — the hook itself refused (halt, size cap, unregistered pool):
    // say which, instead of the generic "may lack liquidity" 502.
    const { status, body } = marketHookRevertResponse(err);
    res.status(status).json(body);
    return;
  }
  logger.warn({ err }, `${label}: quote failed`);
  res.status(502).json({
    error: "Couldn't quote this trade — the pool may lack liquidity at this size.",
    code: "QUOTE_FAILED",
  });
}

export function createMarketTradeRouter(overrides: Partial<MarketTradeDeps> = {}): Router {
  const deps: MarketTradeDeps = {
    build: overrides.build ?? buildMarketTrade,
    checkCap: overrides.checkCap ?? checkSpendingCap,
    spendIo: overrides.spendIo ?? { check: checkSpendingCap, record: recordSpending },
  };
  const router = Router();

  /**
   * POST /api/markets/trade/quote — the pre-trade quote for one outcome-token
   * trade (task 050). Same body as the calldata route, same builder, but the
   * response carries NO executable calldata: amounts, effective price, the
   * hook's fee quote, and the market's addresses — nothing a wallet can sign.
   *
   * Cap semantics: buys run a READ-ONLY cap check so the ticket can show
   * "over your daily cap" before the user commits, and the ledger is never
   * written. The trade ticket re-quotes on every amount change, so this is
   * the path that must leave no ink — a user trying a few sizes consumes
   * nothing. Sells touch no cap at all.
   */
  router.post(
    "/api/markets/trade/quote",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const read = readTradeRequest(req, res);
      if (!read) return;
      const { wallet, args, spendUsd } = read;
      try {
        if (spendUsd !== null) await deps.checkCap(wallet, spendUsd);
        res.json(toMarketTradeQuote(await deps.build(args)));
        counters.inc("market-quote.ok");
      } catch (err) {
        respondTradeError(err, res, wallet, "market-quote");
      }
    },
  );

  /**
   * POST /api/markets/trade/calldata — quote + calldata for one outcome-token
   * trade (B7-003, DM-112 direct leg). Called once, when the user commits.
   *
   * The server builds, the USER signs: this route holds no keys and moves no
   * funds. The shared `buildMarketTrade` also powers the strategy executor
   * and the agent, so every path trades identically.
   *
   * C-019 — signed calldata still moves the user's money, so buys pass the
   * daily spending cap and record the spend intent server-side (guardSpend)
   * before any calldata is returned. The intent is inked HERE and only here:
   * the verified fill (`/api/markets/fills`) confirms the trade but never
   * writes the ledger a second time, and the quote route above writes it
   * never — one trade, one record.
   */
  router.post(
    "/api/markets/trade/calldata",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const read = readTradeRequest(req, res);
      if (!read) return;
      const { wallet, args, spendUsd } = read;
      try {
        // A failed check or a failed build leaves no ink (guardSpend).
        const built =
          spendUsd === null
            ? await deps.build(args)
            : await guardSpend(
                () => Promise.resolve(spendUsd),
                wallet,
                () => deps.build(args),
                deps.spendIo,
              );
        res.json(built);
        counters.inc("market-trade.ok");
      } catch (err) {
        respondTradeError(err, res, wallet, "market-trade");
      }
    },
  );

  return router;
}

export const marketTradeRouter = createMarketTradeRouter();
