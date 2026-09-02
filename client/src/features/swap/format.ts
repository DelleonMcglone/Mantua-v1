import { TOKENS, type TokenSymbol } from "@/lib/tokens.ts";

/** Format a raw base-units amount as a human-readable string in token units. */
export function formatTokenAmount(symbol: TokenSymbol, amountRaw: string | bigint): string {
  const decimals = TOKENS[symbol].decimals;
  const raw = typeof amountRaw === "bigint" ? amountRaw : BigInt(amountRaw || "0");
  const denom = 10n ** BigInt(decimals);
  const whole = raw / denom;
  const frac = raw % denom;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr.slice(0, 6)}`;
}

/** Parse a human-readable amount in token units to raw base units. */
export function parseTokenAmount(symbol: TokenSymbol, input: string): bigint {
  const decimals = TOKENS[symbol].decimals;
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed)) throw new Error("Invalid amount");
  if (trimmed === "" || trimmed === ".") return 0n;
  const [whole = "", frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt((whole || "0") + fracPadded);
}
