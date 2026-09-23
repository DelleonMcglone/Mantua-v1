/**
 * T-024 — the Dynamic Market Hook's trade-facing reverts, decoded.
 *
 * A market quote touches the hook twice: V4Quoter simulates the swap (the
 * hook's `beforeSwap` runs, and PoolManager wraps any revert in
 * `WrappedError`, which the quoter wraps again in `UnexpectedRevertBytes`),
 * and `quoteFee` reads the fee directly. Either can refuse the trade with
 * one of MarketErrors.sol's custom errors. Without this module they all
 * collapsed into the route's generic QUOTE_FAILED ("the pool may lack
 * liquidity"), which is wrong advice for a paused, resolved, or frozen
 * market. The halt reasons are separate errors on-chain precisely so the
 * interface can say which situation the trader is in (MarketErrors.sol).
 */
import { decodeErrorResult, parseAbi } from "viem";
import { mostSpecificRevertBytes } from "../v4-onchain-swap.ts";

/** Mirror of contracts/src/hooks/dynamic-market/MarketErrors.sol — only
 *  the errors a trade (quote or swap) can hit. Selectors are pinned in the
 *  test so a rename on-chain shows up here. */
export const MARKET_HOOK_TRADE_ERRORS_ABI = parseAbi([
  "error MarketPaused()",
  "error MarketResolved()",
  "error MarketVoided()",
  "error MarketFrozen()",
  "error TradeExceedsCap(uint256 notional, uint256 cap)",
  "error PoolNotRegistered()",
]);

export type MarketHookRevertReason =
  | "paused"
  | "resolved"
  | "voided"
  | "frozen"
  | "exceeds_cap"
  | "not_registered";

const REASON_BY_ERROR: Partial<Record<string, MarketHookRevertReason>> = {
  MarketPaused: "paused",
  MarketResolved: "resolved",
  MarketVoided: "voided",
  MarketFrozen: "frozen",
  TradeExceedsCap: "exceeds_cap",
  PoolNotRegistered: "not_registered",
};

const MESSAGE: Record<MarketHookRevertReason, string> = {
  paused: "This market is paused by the operator — trading resumes when it is unpaused.",
  resolved: "This market has resolved — trading is over; positions redeem.",
  voided: "This market was voided — trading is over; positions redeem at the void price.",
  frozen: "This market is frozen — the game is final or past its maximum duration.",
  exceeds_cap: "This trade is larger than the market's current size cap.",
  not_registered: "This market's pool is not open for trading yet.",
};

/** The hook refused the trade for a named reason. `notional`/`cap` are raw
 *  6dp USDC, set only for `exceeds_cap`. */
export class MarketHookRevertError extends Error {
  readonly reason: MarketHookRevertReason;
  readonly notional?: bigint;
  readonly cap?: bigint;

  constructor(reason: MarketHookRevertReason, sizes?: { notional: bigint; cap: bigint }) {
    super(MESSAGE[reason]);
    this.name = "MarketHookRevertError";
    this.reason = reason;
    if (sizes) {
      this.notional = sizes.notional;
      this.cap = sizes.cap;
    }
  }
}

/** Decode a failed quoter/`quoteFee` call into a MarketHookRevertError, or
 *  null when the failure is not one of the hook's trade errors. */
export function decodeMarketHookRevert(err: unknown): MarketHookRevertError | null {
  const bytes = mostSpecificRevertBytes(err);
  if (!bytes || bytes.length < 10) return null;
  let decoded;
  try {
    decoded = decodeErrorResult({ abi: MARKET_HOOK_TRADE_ERRORS_ABI, data: bytes });
  } catch {
    return null;
  }
  const reason = REASON_BY_ERROR[decoded.errorName];
  if (!reason) return null;
  if (decoded.errorName === "TradeExceedsCap") {
    const [notional, cap] = decoded.args;
    return new MarketHookRevertError(reason, { notional, cap });
  }
  return new MarketHookRevertError(reason);
}

/** Run a hook-touching call; a named hook revert becomes a
 *  MarketHookRevertError, anything else rethrows unchanged. */
export async function withMarketHookErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw decodeMarketHookRevert(err) ?? err;
  }
}

const RESPONSE: Record<MarketHookRevertReason, { code: string; status: number }> = {
  paused: { code: "MARKET_PAUSED", status: 503 },
  resolved: { code: "MARKET_RESOLVED", status: 409 },
  voided: { code: "MARKET_VOIDED", status: 409 },
  frozen: { code: "MARKET_FROZEN", status: 409 },
  exceeds_cap: { code: "TRADE_EXCEEDS_CAP", status: 400 },
  not_registered: { code: "MARKET_NOT_OPEN", status: 503 },
};

/** The typed HTTP response for a hook revert — shared by the market and
 *  combo trade routes so both surface the same codes. 409 for the
 *  permanent/terminal halts, 503 for the ones that clear, 400 for a size
 *  the trader can change. */
export function marketHookRevertResponse(err: MarketHookRevertError): {
  status: number;
  body: { error: string; code: string; details?: { notional: string; cap: string } };
} {
  const { code, status } = RESPONSE[err.reason];
  const body: ReturnType<typeof marketHookRevertResponse>["body"] = { error: err.message, code };
  if (err.notional !== undefined && err.cap !== undefined) {
    body.details = { notional: err.notional.toString(), cap: err.cap.toString() };
  }
  return { status, body };
}
