/**
 * The one number/currency formatting module (B-015). Every USD, token,
 * percent, address, or relative-time string rendered in the client comes
 * from here — the v2 reusability audit flagged six divergent USD
 * formatters as a trust bug in a financial product.
 *
 * Conventions (the most common of the pre-existing renderings):
 *  - USD: `$` + en-US grouping + exactly 2 fraction digits; `<$0.01`
 *    for positive dust; `$—` when the input isn't a finite number.
 *  - Locale is pinned to en-US so grouping/decimals don't drift per
 *    browser — the same value must read identically everywhere.
 */

const USD_2DP = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Full-precision USD — `$1,234.56`, `<$0.01`, `$0.00`, `$—`. */
export function usd(value: number): string {
  if (!Number.isFinite(value)) return "$—";
  if (value === 0) return "$0.00";
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${USD_2DP.format(value)}`;
}

/** Compact USD for stat tiles — `$1.20B` / `$824.00K` / `$14.32`. */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/** Token amount — up to 6 fraction digits, `<0.000001` for dust, `0` for zero. */
export function token(value: number, maxFractionDigits = 6): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (value > 0 && value < 0.000001) return "<0.000001";
  return value.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
}

/** Percent — `12.34%`, `—` when not finite. Input is the percent value, not a ratio. */
export function pct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}

/** EVM address / hash shortener — `0x1234…abcd`. Short inputs pass through. */
export function address(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Relative time from a unix-seconds timestamp — `just now` / `5m ago` / `3h ago` / `2d ago`. */
export function relativeTime(unixSeconds: number, nowMs = Date.now()): string {
  const s = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (s < 60) return "just now";
  if (s < 3600) return `${String(Math.floor(s / 60))}m ago`;
  if (s < 86_400) return `${String(Math.floor(s / 3600))}h ago`;
  return `${String(Math.floor(s / 86_400))}d ago`;
}
