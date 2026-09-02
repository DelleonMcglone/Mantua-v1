import { parseTokenAmount } from "@/features/swap/format.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";

export function isStable(s: TokenSymbol): boolean {
  return s === "USDC" || s === "EURC";
}

export function safeParse(symbol: TokenSymbol, input: string): string {
  if (!input || input === ".") return "0";
  try {
    return parseTokenAmount(symbol, input).toString();
  } catch {
    return "0";
  }
}

export function ratioLabel(a: string, b: string): string {
  const an = parseFloat(a);
  const bn = parseFloat(b);
  if (!Number.isFinite(an) || an === 0 || !Number.isFinite(bn)) return "—";
  return (bn / an).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export type CreateStatus =
  | "idle"
  | "preparing"
  | "signing"
  | "pending"
  | "success"
  | "error"
  | "exists";

export function ctaLabel(status: CreateStatus, notReady: boolean): string {
  if (notReady) return "Enter amounts";
  switch (status) {
    case "preparing":
      return "Preparing calldata…";
    case "signing":
      return "Sign in wallet…";
    case "pending":
      return "Waiting for confirmation…";
    case "success":
      return "Pool created";
    case "exists":
      return "Pool already exists";
    default:
      return "Create pool";
  }
}
