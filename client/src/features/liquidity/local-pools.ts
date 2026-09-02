import { isSupportedChainId, type SupportedChainId } from "@/lib/chains.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "./fee-tiers.ts";
import type { HookName } from "./use-create-pool.ts";

const STORAGE_KEY = "mantua.localPools.v2";

export interface LocalPool {
  /** Lowercased composite key — `${chainId}|${tokenA}|${tokenB}|${fee}|${hook ?? "none"}`.
   *  Token order is canonicalized by `localPoolKey`; chainId is part of
   *  the key so the same pair on different chains doesn't collide. */
  key: string;
  /** Chain the pool was created on. Entries from unsupported chains are
   *  filtered out by `getLocalPools()`. */
  chainId: SupportedChainId;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  hook: HookName | null;
  /** Last on-chain init or add-liquidity tx hash on this pool. */
  txHash: string;
  /** The pool's creation (initialize) tx hash — set once when the pool
   *  is first created, preserved across later add-liquidity updates.
   *  Surfaced as the "Pool created" link on the pool detail page. */
  createdTx?: string;
  /** ms epoch of the most recent activity. */
  lastSeenAt: number;
}

export function localPoolKey(
  chainId: SupportedChainId,
  tokenA: TokenSymbol,
  tokenB: TokenSymbol,
  fee: FeeTier,
  hook: HookName | null,
): string {
  const [a, b] = [tokenA, tokenB].sort();
  return `${String(chainId)}|${a}|${b}|${String(fee)}|${hook ?? "none"}`;
}

/**
 * Read pools. Entries from chains we no longer support are filtered out.
 */
export function getLocalPools(): LocalPool[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalPool[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => isSupportedChainId(p.chainId))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  } catch {
    return [];
  }
}

export function rememberLocalPool(entry: Omit<LocalPool, "key" | "lastSeenAt">) {
  if (typeof window === "undefined") return;
  try {
    const existing = getLocalPools();
    const key = localPoolKey(entry.chainId, entry.tokenA, entry.tokenB, entry.fee, entry.hook);
    const prior = existing.find((p) => p.key === key);
    const { createdTx: entryCreatedTx, ...rest } = entry;
    // Preserve the original creation tx across later add-liquidity updates
    // (which don't carry it).
    const createdTx = entryCreatedTx ?? prior?.createdTx;
    const next: LocalPool = {
      ...rest,
      key,
      ...(createdTx ? { createdTx } : {}),
      lastSeenAt: Date.now(),
    };
    const others = existing.filter((p) => p.key !== key);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([next, ...others]));
  } catch {
    // localStorage write failures are non-fatal.
  }
}
