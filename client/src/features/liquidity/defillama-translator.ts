import type { SupportedChainId } from "../../lib/chains.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "./fee-tiers.ts";
import { hookForPairAndFee } from "./hook-recommendations.ts";
import type { HookName } from "./use-create-pool.ts";
import type { PoolSummary } from "./types.ts";

/**
 * DefiLlama uses uppercase symbols and "WETH" for native ETH. Map them
 * to Mantua's TokenSymbol registry. Pools with tokens outside this set
 * fall back to a disabled Add button.
 */
const SYMBOL_ALIASES: Record<string, TokenSymbol> = {
  USDC: "USDC",
  EURC: "EURC",
  CBBTC: "cbBTC",
};

const FEE_TIER_BY_LABEL: Record<string, FeeTier> = {
  "0.01%": 100,
  "0.05%": 500,
  "0.30%": 3000,
  "0.3%": 3000,
  "1.00%": 10000,
  "1%": 10000,
};

export interface DerivedAddCtx {
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  /** Hook bound to the existing pool, recovered from pair + fee tier.
   *  Null = no-hook pool. Lets the Add-Liquidity form lock onto the
   *  pool's actual hook instead of the pair's default recommendation. */
  hook: HookName | null;
}

function symbolToToken(s: string): TokenSymbol | null {
  return SYMBOL_ALIASES[s.toUpperCase()] ?? null;
}

/** Parse a DefiLlama pair symbol like "WETH-USDC" into our two tokens. */
export function parsePairSymbol(symbol: string): [TokenSymbol, TokenSymbol] | null {
  const parts = symbol.split("-");
  if (parts.length !== 2) return null;
  const a = symbolToToken(parts[0] ?? "");
  const b = symbolToToken(parts[1] ?? "");
  if (!a || !b || a === b) return null;
  return [a, b];
}

/** Parse a DefiLlama poolMeta string like "0.05%" into a v4 fee tier. */
export function parseFeeTier(meta: string | null): FeeTier | null {
  if (!meta) return null;
  return FEE_TIER_BY_LABEL[meta.trim()] ?? null;
}

/**
 * Try to derive a v4 PoolKey context (tokens + fee) from a DefiLlama
 * pool row. Returns null if the pool's tokens or fee tier can't be
 * mapped to our supported set. Caller is still responsible for
 * verifying the v4 pool exists on-chain (via /api/pool-state).
 */
export function tryDeriveAddCtx(
  pool: Pick<PoolSummary, "symbol" | "feeTier">,
  chainId: SupportedChainId,
): DerivedAddCtx | null {
  const pair = parsePairSymbol(pool.symbol);
  const fee = parseFeeTier(pool.feeTier);
  if (!pair || fee === null) return null;
  return {
    tokenA: pair[0],
    tokenB: pair[1],
    fee,
    hook: hookForPairAndFee(pair[0], pair[1], fee, chainId),
  };
}
