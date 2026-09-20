/**
 * P4e-005 — friendly mapping for v4 remove-liquidity reverts.
 *
 * The on-chain `amount0Min` / `amount1Min` revert is the most common
 * remove-liquidity failure: the pool price moved between when the user
 * opened the modal and when the tx confirmed, so the expected output
 * is no longer guaranteed. The raw revert string is technically
 * accurate but unhelpful — this mapping translates it to plain English
 * while preserving the original reason for power users / support.
 *
 * Pure logic, UI-agnostic. The actual error display lives in the
 * design's RemoveLiquidityPanel and ports separately as part of the
 * design implementation.
 */

export interface MappedRevert {
  /** Short, plain-English headline. */
  title: string;
  /** Explanatory body copy. May be the raw reason itself for unknown reverts. */
  body: string;
  /** Verbatim revert reason, always present. Surfaces under "Technical details". */
  raw: string;
  /** Optional CTA. Present only for known reverts where retry is meaningful. */
  action?: { label: string; kind: "primary" };
}

const AMOUNT_MIN_PATTERN = /amount[01]min/i;
const POOL_PRICE_MOVED_BODY =
  "The price changed since you opened this position, so the expected output is " +
  "no longer guaranteed. Refresh to see current amounts and try again.";

/**
 * Map an arbitrary error value (from `useRemoveLiquidity` or any tx hook)
 * to a structured banner shape. Always returns a MappedRevert — never
 * throws.
 */
export function mapRevert(input: unknown): MappedRevert {
  const raw = extractRawReason(input);

  if (AMOUNT_MIN_PATTERN.test(raw)) {
    return {
      title: "Pool price has moved",
      body: POOL_PRICE_MOVED_BODY,
      raw,
      action: { label: "Refresh & retry", kind: "primary" },
    };
  }

  return { title: "Transaction reverted", body: raw, raw };
}

/**
 * Pull the raw revert reason from whatever shape the caller hands us.
 * Walks `.cause` chains for viem/wagmi-wrapped errors so nested revert
 * reasons aren't masked by an outer wrapper message.
 */
export function extractRawReason(input: unknown): string {
  if (input == null) return "Unknown error";
  if (typeof input === "string") return input;
  if (input instanceof Error) {
    const chain: string[] = [];
    let cursor: unknown = input;
    const seen = new Set<unknown>();
    while (cursor instanceof Error && !seen.has(cursor)) {
      seen.add(cursor);
      if (cursor.message) chain.push(cursor.message);
      cursor = (cursor as Error & { cause?: unknown }).cause;
    }
    return chain.length > 0 ? chain.join(" — ") : "Unknown error";
  }
  if (typeof input === "object") {
    const maybeMessage = (input as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
    try {
      return JSON.stringify(input);
    } catch {
      return "Unknown error";
    }
  }
  // Objects are handled above; remaining values are primitives where
  // String() is safe and never yields "[object Object]".
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(input);
}
