import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "./logger.ts";

const TRADING_API = "https://trade-api.gateway.uniswap.org/v1";

/**
 * Subset of the Uniswap Trading API quote response we rely on. Full shape
 * is permissive (passthrough) — we read what we need and pass the rest
 * through to the client unmodified.
 */
const quoteResponseSchema = z
  .object({
    requestId: z.string(),
    routing: z.string(),
    permitData: z
      .object({
        domain: z.unknown(),
        types: z.unknown(),
        values: z.unknown(),
      })
      .nullable()
      .optional(),
    quote: z
      .object({
        chainId: z.number(),
        swapper: z.string(),
        tradeType: z.string(),
        slippage: z.number().optional(),
        priceImpact: z.number().optional(),
        gasFee: z.string().optional(),
        gasFeeUSD: z.string().optional(),
        gasUseEstimate: z.string().optional(),
        quoteId: z.string(),
        input: z.object({ amount: z.string(), token: z.string() }),
        output: z.object({
          amount: z.string(),
          token: z.string(),
          recipient: z.string(),
        }),
        aggregatedOutputs: z
          .array(
            z.object({
              amount: z.string(),
              token: z.string(),
              minAmount: z.string(),
            }),
          )
          .optional(),
      })
      .loose(),
  })
  .loose();

export type UniswapQuote = z.infer<typeof quoteResponseSchema>;

const swapResponseSchema = z
  .object({
    requestId: z.string(),
    swap: z
      .object({
        to: z.string(),
        data: z.string(),
        value: z.string(),
        gasLimit: z.string().optional(),
      })
      .loose(),
  })
  .loose();

export type UniswapSwapTx = z.infer<typeof swapResponseSchema>["swap"];

export interface QuoteParams {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  swapper: string;
  /** Slippage tolerance in fractional percent (0.5 = 0.5%). Optional; defaults to API auto-slippage. */
  slippageTolerance?: number;
}

export async function fetchQuote(params: QuoteParams): Promise<UniswapQuote> {
  if (!env.UNISWAP_TRADING_API_KEY) {
    throw new Error("UNISWAP_TRADING_API_KEY is not set");
  }
  const body = {
    type: params.type,
    tokenInChainId: params.chainId,
    tokenOutChainId: params.chainId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amount: params.amount,
    swapper: params.swapper,
    ...(params.slippageTolerance !== undefined
      ? { slippageTolerance: params.slippageTolerance }
      : { autoSlippage: true }),
  };
  const res = await fetch(`${TRADING_API}/quote`, {
    method: "POST",
    headers: {
      "x-api-key": env.UNISWAP_TRADING_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ status: res.status, body: text }, "uniswap quote failed");
    throw new Error(`Quote failed: ${String(res.status)} ${text.slice(0, 200)}`);
  }
  const json: unknown = await res.json();
  return quoteResponseSchema.parse(json);
}

export async function fetchSwapTx(quote: UniswapQuote, signature?: string): Promise<UniswapSwapTx> {
  if (!env.UNISWAP_TRADING_API_KEY) {
    throw new Error("UNISWAP_TRADING_API_KEY is not set");
  }
  const body: Record<string, unknown> = { quote: quote.quote };
  if (quote.permitData && signature) {
    body["permitData"] = quote.permitData;
    body["signature"] = signature;
  }
  const res = await fetch(`${TRADING_API}/swap`, {
    method: "POST",
    headers: {
      "x-api-key": env.UNISWAP_TRADING_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ status: res.status, body: text }, "uniswap swap calldata failed");
    throw new Error(`Swap calldata failed: ${String(res.status)} ${text.slice(0, 200)}`);
  }
  const json: unknown = await res.json();
  return swapResponseSchema.parse(json).swap;
}
