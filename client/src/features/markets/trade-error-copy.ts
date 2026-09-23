/**
 * T-012 — the copy table behind `describeTradeError`: one entry per server
 * code the trade route, the kill-switch gate, and the spending cap can
 * return. Owner-readable, chainless. Pure data.
 */
import type { TradeErrorCopy } from "./trade-errors.ts";

export const RETRY = { label: "Try again", kind: "retry" } as const;

export const RATE_LIMITED: TradeErrorCopy = {
  kind: "rate-limit",
  title: "Slow down a moment",
  body: "Too many requests in a row. Wait a few seconds and try again.",
  action: RETRY,
};
export const LOGIN: TradeErrorCopy = {
  kind: "login",
  title: "Log in to trade",
  body: "Browsing is free; trading needs an account.",
  action: { label: "Log in", kind: "login" },
};

export const BY_CODE: Partial<Record<string, TradeErrorCopy>> = {
  BETTING_CLOSED: {
    kind: "closed",
    title: "This market is closed",
    body: "Trading closes when the game goes final. Your existing positions settle automatically.",
  },
  TRADING_HALTED: {
    kind: "halted",
    title: "Buying is paused",
    body: "The live game feed is behind, so new buys are paused until it catches up. Selling still works.",
    action: RETRY,
  },
  spending_cap_exceeded: {
    kind: "cap",
    title: "Over your daily limit",
    body: "This trade would pass your daily spending cap. Try a smaller amount, or raise the cap in your profile.",
  },
  spending_cap_hard_ceiling: {
    kind: "cap",
    title: "Over the platform limit",
    body: "This trade is above the maximum daily amount. Try a smaller amount.",
  },
  KILL_SWITCH_ACTIVE: {
    kind: "paused",
    title: "Trading is paused",
    body: "Mantua has paused trading for everyone. Nothing was placed. Check back shortly.",
  },
  kill_switch_active: {
    kind: "paused",
    title: "Trading is paused",
    body: "Mantua has paused trading for everyone. Nothing was placed. Check back shortly.",
  },
  MARKETS_NOT_DEPLOYED: {
    kind: "not-deployed",
    title: "Markets are opening soon",
    body: "Trading on this game opens when Mantua's markets go live. You can still browse and analyze.",
  },
  NO_MARKET: {
    kind: "no-market",
    title: "No market for this game yet",
    body: "Markets open as the schedule fills in. Try another game.",
  },
  // T-024 — the market's hook refused the trade. Each halt is its own
  // situation: a frozen or settled market is over, a paused one waits for
  // the operator, one not yet open waits for its pool.
  MARKET_FROZEN: {
    kind: "closed",
    title: "This market is closed",
    body: "The game is over, so trading has stopped. Your positions settle once the result is confirmed.",
  },
  MARKET_RESOLVED: {
    kind: "resolved",
    title: "This market has settled",
    body: "Trading is over. If you hold winning shares, you can redeem them from your positions.",
  },
  MARKET_VOIDED: {
    kind: "voided",
    title: "This market was cancelled",
    body: "Trading is over. Any shares you hold can be redeemed for their refund from your positions.",
  },
  MARKET_PAUSED: {
    kind: "paused",
    title: "This market is paused",
    body: "Trading on this game is paused for now. Nothing was placed. Check back shortly.",
    action: RETRY,
  },
  MARKET_NOT_OPEN: {
    kind: "not-open",
    title: "This market isn't open yet",
    body: "Trading on this game opens shortly. Try again in a few minutes.",
    action: RETRY,
  },
  TRADE_EXCEEDS_CAP: {
    kind: "size-cap",
    title: "Too large for this market",
    body: "This market has a per-trade limit right now. Try a smaller amount.",
  },
  QUOTE_FAILED: {
    kind: "quote",
    title: "Couldn't price this size",
    body: "The market can't fill an order this large right now. Try a smaller amount.",
    action: RETRY,
  },
  RATE_LIMITED,
  UNAUTHENTICATED: LOGIN,
  WALLET_REQUIRED: {
    kind: "login",
    title: "Log in to trade",
    body: "Finish logging in so your wallet is ready to trade.",
    action: { label: "Log in", kind: "login" },
  },
  slippage_too_high: {
    kind: "price-moved",
    title: "The price moved",
    body: "The market moved past your limit before this trade could go through. Re-check the price and try again.",
    action: RETRY,
  },
  BAD_REQUEST: {
    kind: "bad-amount",
    title: "Check the amount",
    body: "Enter an amount between $0.01 and $100,000.",
  },
  wrong_chain: {
    kind: "unknown",
    title: "Couldn't place the trade",
    body: "Something didn't line up. Try again.",
    action: RETRY,
  },
  wallet_unknown: {
    kind: "login",
    title: "Log in to trade",
    body: "We couldn't find your wallet. Log in again.",
    action: { label: "Log in", kind: "login" },
  },
};
