/**
 * 029 — pure helpers for the deposit/withdraw UX (C-011 GAP-1/2/4).
 * No React, no I/O: address validation and amount parsing/clamping live
 * here so they can be unit-tested in isolation (node:test).
 */

/** Strict EVM address shape — 0x + exactly 40 hex chars. */
export function isValidEvmAddress(input: string): input is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(input);
}

/**
 * Parse a human-entered token amount (e.g. "1.5") into raw base units.
 * Returns null for anything that isn't a plain positive decimal number —
 * including more fraction digits than the token carries (rejecting beats
 * silently rounding someone's money).
 */
export function parseAmountRaw(amount: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  const trimmed = amount.trim();
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) return null;
  const dot = trimmed.indexOf(".");
  const whole = dot === -1 ? trimmed : trimmed.slice(0, dot);
  const fraction = dot === -1 ? "" : trimmed.slice(dot + 1);
  if (fraction.length > decimals) return null;
  const raw =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) return null;
  return raw;
}

/** Clamp a raw amount to the available raw balance (max-button semantics). */
export function clampToBalance(raw: bigint, balanceRaw: bigint): bigint {
  if (raw < 0n) return 0n;
  return raw > balanceRaw ? balanceRaw : raw;
}

/**
 * Render a raw base-unit balance as a human amount string with full
 * precision and no trailing zeros — what the Max button drops into the
 * amount input ("1500000" @ 6dp → "1.5").
 */
export function formatRawAmount(raw: bigint, decimals: number): string {
  if (raw <= 0n || !Number.isInteger(decimals) || decimals < 0) return "0";
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}
