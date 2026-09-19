import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { logger } from "../lib/logger.ts";
import { env } from "../env.ts";
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
import { SafetyError } from "../lib/errors.ts";
import { counters } from "../lib/metrics.ts";
import {
  checkSpendingCap,
  guardSpend,
  recordSpending,
  getDailyCap,
  getDailySpend,
  type SpendGuardIo,
} from "../lib/spending-cap.ts";
import {
  payerFromPaymentHeader,
  x402PaywallDepsFromEnv,
  x402ServiceChain,
  type X402PaywallDeps,
} from "../middleware/x402-paywall.ts";
import { getX402ServiceDef, parseCommaList, type X402ServiceDef } from "../lib/x402/catalog.ts";

/**
 * Phase 17 (MP-007) — the PAID trading services on /api/x402/v1: an external
 * agent pays x402 (either rail) for a quote or for execution-ready calldata.
 * The caller signs the resulting calldata with its OWN wallet — the server
 * holds no keys and executes nothing, so there is deliberately NO call into
 * `circle/execute.ts` anywhere on these routes.
 *
 * Cap accounting (C-019) keys the dailyWalletSpend ledger to the SETTLING
 * PAYER address — the payment IS the identity for external callers. The same
 * check → build → record discipline as the browser path applies: a refused
 * cap check or a failed build leaves no ledger ink, and a typed refusal
 * after payment (cap_blocked 403, BETTING_CLOSED 409, TRADING_HALTED 503,
 * NO_MARKET 404) is a definitive ANSWER to the paid request — the caller
 * asked "would this trade work", and "no, here's why" is the service
 * delivering, not an outage.
 *
 * Trading happens on Base (the settlement network); the request schema is
 * the browser trade shape minus chainId (spec sketch: providerEventId,
 * outcomeIndex, direction, amountRaw, slippageBps).
 */

const bodySchema = z.object({
  providerEventId: z.string().min(1).max(32),
  /** 0 = home market, 1 = away market — whose YES the caller is trading. */
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
  /** Execution price bound in bps — becomes the on-chain slippage guard. */
  slippageBps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).optional(),
});

/** Seams for `createX402TradingRouter` — the house factory-override pattern
 *  (see market-trade.ts). Tests inject a fake builder, ledger fakes, and
 *  paywall deps; production wires the real ones. */
export interface X402TradingDeps {
  /** The one builder (market-trade-build.ts) — quote and calldata alike. */
  build: typeof buildMarketTrade;
  /** The C-019 ledger seam for calldata issuance (check → issue → record). */
  spendIo: SpendGuardIo;
  /** Read-only cap state for the payer — drives `capRemainingUsd`. */
  capState: (payer: string) => Promise<{ capUsd: number; spentUsd: number }>;
  /** Paywall construction inputs (env in production; inline in tests). */
  paywall: X402PaywallDeps;
}

/** The two paid trading services, by catalog id. */
const QUOTE_DEF = getX402ServiceDef("trading-quote") as X402ServiceDef;
const CALLDATA_DEF = getX402ServiceDef("trading-calldata") as X402ServiceDef;

/** Parse + payer-resolve the shared request shape; null when a response was sent. */
function readPaidTradeRequest(
  req: Request,
  res: Response,
): { payer: string; args: Parameters<typeof buildMarketTrade>[0]; spendUsd: number | null } | null {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid trade", code: "BAD_REQUEST", details: parsed.error.issues });
    return null;
  }
  // Payment ran before this handler (the paywall verified it), so the payer
  // is in the payload. A missing payer after verification is shape drift —
  // fail closed and log loudly rather than key the ledger to nothing.
  const payer = payerFromPaymentHeader(req);
  if (!payer) {
    logger.error({ path: req.path }, "x402 trading: verified payment without a payer address");
    res
      .status(500)
      .json({ error: "Could not resolve the paying wallet", code: "PAYER_RESOLVE_FAILED" });
    return null;
  }
  const amountRaw = BigInt(parsed.data.amountRaw);
  const args: Parameters<typeof buildMarketTrade>[0] = {
    providerEventId: parsed.data.providerEventId,
    outcomeIndex: parsed.data.outcomeIndex,
    direction: parsed.data.direction,
    amountRaw,
    ...(parsed.data.slippageBps !== undefined ? { slippageBps: parsed.data.slippageBps } : {}),
  };
  // C-019 — buys spend USDC (the cap's unit of account); sells are exits and
  // touch no cap, matching the browser path's trade_market semantics.
  return { payer, args, spendUsd: marketTradeSpendUsd(parsed.data.direction, amountRaw) };
}

/** Counter label for a trade failure (R-010's trade outcome breakdown). */
function tradeErrorCode(err: unknown): string {
  if (err instanceof SafetyError) return "cap_blocked";
  if (err instanceof MarketsNotDeployedError) return "not_deployed";
  if (err instanceof NoMarketError) return "no_market";
  if (err instanceof MarketClosedError) return "closed";
  if (err instanceof MarketDataOutageError) return "halted";
  return "quote_failed";
}

/**
 * The typed failure surface for the paid routes. Statuses mirror the browser
 * path (market-trade.ts) for every builder failure — BETTING_CLOSED 409,
 * TRADING_HALTED 503 (P-012), NO_MARKET 404 — with one deliberate
 * difference: a refused cap is 403 cap_blocked (the spec's external
 * contract) instead of the browser path's 400, and carries the cap info the
 * spec names.
 */
function respondPaidTradeError(err: unknown, res: Response, payer: string, label: string): void {
  counters.inc(`${label}.${tradeErrorCode(err)}`);
  if (err instanceof SafetyError) {
    logger.warn({ err, payer }, `${label}: blocked by the spending cap`);
    const details = err.details as Partial<Record<string, number>>;
    res.status(403).json({
      error: err.message,
      code: "cap_blocked",
      dailyCapUsd: details.cap ?? details.hardCeiling,
      spentUsd: details.spent,
      requestedUsd: details.usdAmount,
    });
    return;
  }
  if (err instanceof MarketsNotDeployedError) {
    // Gated state, not a failure: the market stack isn't live on this
    // chain. Surface it as such — never an opaque 502.
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
    // temporary error; sells never reach this branch. 503 because the
    // condition clears when the feed recovers.
    res.status(503).json({ error: err.message, code: "TRADING_HALTED" });
    return;
  }
  logger.warn({ err }, `${label}: quote failed`);
  res.status(502).json({
    error: "Couldn't quote this trade — the pool may lack liquidity at this size.",
    code: "QUOTE_FAILED",
  });
}

export function createX402TradingRouter(overrides: Partial<X402TradingDeps> = {}): Router {
  const deps: X402TradingDeps = {
    build: overrides.build ?? buildMarketTrade,
    spendIo: overrides.spendIo ?? { check: checkSpendingCap, record: recordSpending },
    capState:
      overrides.capState ??
      (async (payer) => ({
        capUsd: await getDailyCap(payer),
        spentUsd: await getDailySpend(payer),
      })),
    paywall:
      overrides.paywall ??
      x402PaywallDepsFromEnv({
        ...env,
        X402_SELLER_SERVICES: parseCommaList(env.X402_SELLER_SERVICES),
        X402_SPORTS_INTEL_ALLOWLIST: parseCommaList(env.X402_SPORTS_INTEL_ALLOWLIST),
      }),
  };
  const router = Router();

  /**
   * POST /api/x402/v1/trading/quote — the paid pre-trade quote (MP-007).
   * Buys run a READ-ONLY cap check (the ledger is never inked by a quote —
   * one trade, one record, reserved for calldata issuance); sells touch no
   * cap. The response carries the quote plus the payer's remaining daily
   * headroom so an agent can size against its own cap state.
   */
  router.post(
    QUOTE_DEF.path,
    ...x402ServiceChain(QUOTE_DEF, deps.paywall),
    async (req: Request, res: Response) => {
      const read = readPaidTradeRequest(req, res);
      if (!read) return;
      const { payer, args, spendUsd } = read;
      try {
        if (spendUsd !== null) await deps.spendIo.check(payer, spendUsd);
        const [built, cap] = await Promise.all([deps.build(args), deps.capState(payer)]);
        res.json({
          ...toMarketTradeQuote(built),
          capRemainingUsd: Math.max(cap.capUsd - cap.spentUsd, 0),
        });
        counters.inc("x402-trading-quote.ok");
      } catch (err) {
        respondPaidTradeError(err, res, payer, "x402-trading-quote");
      }
    },
  );

  /**
   * POST /api/x402/v1/trading/calldata — the paid calldata issuance (MP-007).
   * guardSpend keys the C-019 daily ledger to the SETTLING PAYER: check cap →
   * build → record. The calldata is signed by the caller's own wallet; the
   * server holds no keys, moves no funds, executes nothing.
   */
  router.post(
    CALLDATA_DEF.path,
    ...x402ServiceChain(CALLDATA_DEF, deps.paywall),
    async (req: Request, res: Response) => {
      const read = readPaidTradeRequest(req, res);
      if (!read) return;
      const { payer, args, spendUsd } = read;
      try {
        // A failed check or a failed build leaves no ink (guardSpend).
        const built =
          spendUsd === null
            ? await deps.build(args)
            : await guardSpend(
                () => Promise.resolve(spendUsd),
                payer,
                () => deps.build(args),
                deps.spendIo,
              );
        const cap = await deps.capState(payer);
        res.json({
          // BuiltMarketTrade names them to/data/value; the spec's external
          // contract speaks calldata/target/value — map at the boundary.
          calldata: built.data,
          target: built.to,
          value: built.value,
          quote: built.quote,
          fee: built.fee,
          capRemainingUsd: Math.max(cap.capUsd - cap.spentUsd, 0),
        });
        counters.inc("x402-trading-calldata.ok");
      } catch (err) {
        respondPaidTradeError(err, res, payer, "x402-trading-calldata");
      }
    },
  );

  return router;
}

export const x402TradingRouter = createX402TradingRouter();
