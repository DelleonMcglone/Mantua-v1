/**
 * T-012 — owner-readable copy for every state a trade can end in. Maps
 * the server's typed codes (`routes/market-trade.ts`, the kill-switch
 * gate, the spending cap) and the client-side conditions (wallet declined,
 * reverted, insufficient balance) to a title, a body, and an optional
 * action. Never throws, never leaks chain vocabulary. Pure — no React, no
 * `@/` imports — so it runs under node:test.
 */
import { extractRawReason } from "./error-mapping.ts";
import { BY_CODE, LOGIN, RATE_LIMITED, RETRY } from "./trade-error-copy.ts";

export type TradeErrorKind =
  | "closed"
  | "halted"
  | "cap"
  | "paused"
  | "not-deployed"
  | "no-market"
  | "quote"
  | "rate-limit"
  | "login"
  | "price-moved"
  | "bad-amount"
  | "insufficient-balance"
  | "declined"
  | "reverted"
  | "unknown";

export interface TradeErrorCopy {
  kind: TradeErrorKind;
  title: string;
  body: string;
  action?: { label: string; kind: "retry" | "fund" | "login" };
}

function isCoded(err: unknown): err is { code: string; status: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string" &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

/** Map any thrown value from the quote/execute path to copy. */
export function describeTradeError(err: unknown): TradeErrorCopy {
  if (isCoded(err)) {
    const known = BY_CODE[err.code];
    if (known) return known;
    if (err.status === 429) return RATE_LIMITED;
    if (err.status === 401) return LOGIN;
  }
  const raw = extractRawReason(err).toLowerCase();
  if (/rejected|denied|declined|cancel/.test(raw)) {
    return {
      kind: "declined",
      title: "Trade not placed",
      body: "You declined it in your wallet, so nothing was placed. Confirm again whenever you're ready.",
      action: RETRY,
    };
  }
  if (/revert/.test(raw)) return revertedTradeError();
  return {
    kind: "unknown",
    title: "Couldn't place the trade",
    body: "Something went wrong on our side. Nothing was placed. Try again in a moment.",
    action: RETRY,
  };
}

/** The trade was mined and reverted (Phase 7 `failed`): nothing traded, nothing charged. */
export function revertedTradeError(): TradeErrorCopy {
  return {
    kind: "reverted",
    title: "The trade didn't go through",
    body: "The market rejected it — usually because the price moved. Nothing was charged. Re-check and try again.",
    action: RETRY,
  };
}

/** Raw 6dp → "$12.34". Local to keep this module React- and alias-free. */
function dollars(raw: bigint): string {
  const cents = (raw + 5_000n) / 10_000n;
  return `$${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** The client-side shortfall: the ticket total vs the wallet balance. */
export function insufficientBalanceError(totalRaw: string, balanceRaw: string): TradeErrorCopy {
  const short = BigInt(totalRaw) - BigInt(balanceRaw);
  return {
    kind: "insufficient-balance",
    title: "Not enough in your balance",
    body: `You're ${dollars(short > 0n ? short : 0n)} short for this trade. Add funds, or try a smaller amount.`,
    action: { label: "Add funds", kind: "fund" },
  };
}
