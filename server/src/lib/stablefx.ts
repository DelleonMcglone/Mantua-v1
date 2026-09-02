import { z } from "zod";
import { env } from "../env.ts";
import { logger } from "./logger.ts";

/**
 * Circle StableFX — institutional RFQ engine for stablecoin FX (USDC↔EURC),
 * built by Circle. We consume it as a price venue: a `type: "reference"` quote is
 * indicative (no recipient address, no EIP-712 signing, nothing to settle), so
 * it's safe for read-only best-execution comparisons against the on-chain pool.
 *
 * Graceful-dark: StableFX access is entitlement-gated per API key. When the
 * key is missing or not enabled for StableFX (401/403), callers get
 * `{ available: false, reason }` instead of an exception — the agent's FX
 * comparison then falls back to pool + Pyth only.
 */

const QUOTES_URL = "https://api.circle.com/v1/exchange/stablefx/quotes";
const TTL_MS = 30_000;

export type FxCurrency = "USDC" | "EURC";
export const FX_CURRENCIES: readonly FxCurrency[] = ["USDC", "EURC"];

export function isFxCurrency(v: unknown): v is FxCurrency {
  return v === "USDC" || v === "EURC";
}

export interface StableFxQuote {
  available: true;
  /** Units of `to` per 1 unit of `from`, as returned by the RFQ engine. */
  rate: number;
  fromCurrency: FxCurrency;
  toCurrency: FxCurrency;
  fromAmount: string;
  toAmount: string;
  /** Fee, denominated in the `to` currency (may be "0"). */
  fee: string;
  expiresAt: string;
}

export interface StableFxUnavailable {
  available: false;
  reason: string;
}

export type StableFxResult = StableFxQuote | StableFxUnavailable;

const quoteResponseSchema = z.object({
  data: z
    .object({
      rate: z.number(),
      from: z.object({ currency: z.string(), amount: z.string() }),
      to: z.object({ currency: z.string(), amount: z.string() }),
      fee: z.string().optional(),
      expiresAt: z.string().optional(),
    })
    // Some Circle APIs wrap in `data`, some don't — accept both below.
    .optional(),
  rate: z.number().optional(),
  from: z.object({ currency: z.string(), amount: z.string() }).optional(),
  to: z.object({ currency: z.string(), amount: z.string() }).optional(),
  fee: z.string().optional(),
  expiresAt: z.string().optional(),
});

interface CacheEntry {
  value: StableFxResult;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();

/**
 * Indicative (reference) RFQ quote for `amount` of `from` into `to`.
 * Never throws — upstream/entitlement failures come back as
 * `{ available: false }` so agent tool calls degrade instead of erroring.
 */
export async function getStableFxQuote(args: {
  from: FxCurrency;
  to: FxCurrency;
  amount: string;
}): Promise<StableFxResult> {
  const { from, to, amount } = args;
  if (from === to) return { available: false, reason: "from and to must differ" };
  if (!env.CIRCLE_API_KEY) {
    return { available: false, reason: "CIRCLE_API_KEY is not configured." };
  }

  const key = `${from}->${to}:${amount}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value;

  let value: StableFxResult;
  try {
    const res = await fetch(QUOTES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CIRCLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { currency: from, amount },
        to: { currency: to },
        tenor: "instant",
        type: "reference",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      value = {
        available: false,
        reason:
          "The Circle API key isn't entitled for StableFX (access is granted per key by Circle).",
      };
    } else if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body: body.slice(0, 300) }, "stablefx quote failed");
      value = { available: false, reason: `StableFX returned HTTP ${String(res.status)}.` };
    } else {
      const parsed = quoteResponseSchema.safeParse(await res.json());
      const q = parsed.success ? (parsed.data.data ?? parsed.data) : null;
      if (!q || typeof q.rate !== "number" || !q.from || !q.to) {
        logger.warn({ issues: parsed.success ? null : parsed.error.issues }, "stablefx schema");
        value = { available: false, reason: "StableFX returned an unexpected response shape." };
      } else {
        value = {
          available: true,
          rate: q.rate,
          fromCurrency: from,
          toCurrency: to,
          fromAmount: q.from.amount,
          toAmount: q.to.amount,
          fee: q.fee ?? "0",
          expiresAt: q.expiresAt ?? "",
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, "stablefx request errored");
    value = { available: false, reason: "StableFX request failed (network/timeout)." };
  }

  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}
