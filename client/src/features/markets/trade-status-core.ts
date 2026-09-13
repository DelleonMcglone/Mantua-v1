/**
 * Phase 7 / R-004 — the trade-status pipeline's pure core.
 *
 * A submitted trade has exactly one of these server-verifiable states, and
 * the UI must never blur them: `submitted` (hash in hand, not yet mined),
 * `confirmed`, `failed` (reverted on-chain), or `unknown` (the network
 * has never seen the hash). "Waiting" is a state with a hash and an
 * explorer link, not an error; "error" is reserved for things that never
 * reached the chain (the wallet declined, the quote failed).
 *
 * Pending trades are persisted per wallet so a reload mid-confirmation
 * resumes them instead of losing them (and re-reports the fill the
 * server may still be missing).
 */

export type TradeTxState = "pending" | "confirmed" | "failed" | "unknown";

export interface PendingTrade {
  txHash: `0x${string}`;
  chainId: number;
  /** The wallet that signed — pending trades are scoped to it. */
  wallet: string;
  marketId: `0x${string}`;
  providerEventId: string;
  direction: "buy" | "sell";
  tokensRaw: string;
  usdcRaw: string;
  submittedAt: number;
}

/** After this long an `unknown` hash is treated as dropped and forgotten. */
export const PENDING_UNKNOWN_GIVE_UP_MS = 15 * 60_000;
/** After this long a still-`pending` hash is kept but labeled slow. */
export const PENDING_SLOW_AFTER_MS = 2 * 60_000;
/** How often the resume loop asks the server while a trade is pending. */
export const PENDING_POLL_MS = 5_000;

/** The reason a trade never reached the chain — each gets its own copy. */
export type TradeErrorKind = "rejected" | "server" | "network" | "unknown";

export interface TradeError {
  kind: TradeErrorKind;
  message: string;
}

/**
 * Classify a thrown error from the quote/calldata/sign path. Wallet
 * rejections are the common, benign case and must not read as failures.
 */
export function classifyTradeError(err: unknown, fallback: string): TradeError {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const name = err instanceof Error ? err.name : "";
  if (
    /user rejected|user denied|rejected the request|denied transaction|UserRejected/i.test(
      `${name} ${message}`,
    )
  ) {
    return {
      kind: "rejected",
      message: "You declined the request in your wallet. Nothing was sent.",
    };
  }
  if (name === "ApiError" || /^Request failed/.test(message)) {
    return { kind: "server", message: message || fallback };
  }
  if (/fetch failed|network|Failed to fetch|ECONN|timed? ?out/i.test(message)) {
    return {
      kind: "network",
      message:
        "Couldn't reach Mantua. Your wallet did not send anything — check your connection and try again.",
    };
  }
  return { kind: "unknown", message: message || fallback };
}

/** What the resume loop should do with a pending trade given the server's answer. */
export type PendingDisposition =
  | { kind: "keep"; slow: boolean }
  | { kind: "confirmed"; needsFillReport: boolean }
  | { kind: "failed" }
  | { kind: "dropped" };

export function disposePending(
  trade: PendingTrade,
  answer: { state: TradeTxState; recorded: boolean },
  now: number,
): PendingDisposition {
  const age = now - trade.submittedAt;
  switch (answer.state) {
    case "confirmed":
      return { kind: "confirmed", needsFillReport: !answer.recorded };
    case "failed":
      return { kind: "failed" };
    case "unknown":
      return age > PENDING_UNKNOWN_GIVE_UP_MS
        ? { kind: "dropped" }
        : { kind: "keep", slow: age > PENDING_SLOW_AFTER_MS };
    case "pending":
      return { kind: "keep", slow: age > PENDING_SLOW_AFTER_MS };
  }
}

// ─── Persistence (localStorage shape) ───────────────────────────────────────

export const PENDING_TRADES_STORAGE_KEY = "mantua:pending-trades:v1";

function isHex(v: unknown, len: number): v is `0x${string}` {
  return typeof v === "string" && new RegExp(`^0x[0-9a-fA-F]{${String(len)}}$`).test(v);
}

/** Parse a stored list defensively: a corrupt entry is skipped, never thrown. */
export function parsePendingTrades(raw: string | null): PendingTrade[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PendingTrade[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    if (
      isHex(t["txHash"], 64) &&
      typeof t["chainId"] === "number" &&
      typeof t["wallet"] === "string" &&
      isHex(t["marketId"], 64) &&
      typeof t["providerEventId"] === "string" &&
      (t["direction"] === "buy" || t["direction"] === "sell") &&
      typeof t["tokensRaw"] === "string" &&
      typeof t["usdcRaw"] === "string" &&
      typeof t["submittedAt"] === "number"
    ) {
      out.push({
        txHash: t["txHash"],
        chainId: t["chainId"],
        wallet: t["wallet"].toLowerCase(),
        marketId: t["marketId"],
        providerEventId: t["providerEventId"],
        direction: t["direction"],
        tokensRaw: t["tokensRaw"],
        usdcRaw: t["usdcRaw"],
        submittedAt: t["submittedAt"],
      });
    }
  }
  return out;
}

export function serializePendingTrades(trades: readonly PendingTrade[]): string {
  return JSON.stringify(trades);
}

/** Trades for one wallet (case-insensitive), newest first. */
export function pendingForWallet(trades: readonly PendingTrade[], wallet: string): PendingTrade[] {
  const w = wallet.toLowerCase();
  return trades.filter((t) => t.wallet === w).sort((a, b) => b.submittedAt - a.submittedAt);
}

export function upsertPending(
  trades: readonly PendingTrade[],
  trade: PendingTrade,
): PendingTrade[] {
  const rest = trades.filter((t) => t.txHash.toLowerCase() !== trade.txHash.toLowerCase());
  return [...rest, { ...trade, wallet: trade.wallet.toLowerCase() }];
}

export function removePending(trades: readonly PendingTrade[], txHash: string): PendingTrade[] {
  const h = txHash.toLowerCase();
  return trades.filter((t) => t.txHash.toLowerCase() !== h);
}
