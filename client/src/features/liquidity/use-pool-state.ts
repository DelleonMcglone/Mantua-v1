import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "./fee-tiers.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";

export interface PoolState {
  exists: boolean;
  sqrtPriceX96: string | null;
  tick: number | null;
}

interface State {
  data: PoolState | null;
  error: ApiError | Error | null;
  loading: boolean;
}

interface ApiRes {
  exists: boolean;
  sqrtPriceX96?: string;
  tick?: number;
}

interface Snapshot {
  key: string;
  data: PoolState | null;
  error: ApiError | Error | null;
}

/**
 * Fetch live slot0 for a v4 pool keyed by tokens + fee tier. Returns
 * `data: null` while loading or when any input is null. `data.exists`
 * tells the caller whether to enable an Add button.
 */
export function usePoolState(
  tokenA: TokenSymbol | null,
  tokenB: TokenSymbol | null,
  fee: FeeTier | null,
): State {
  const chainId = BASE_CHAIN_ID;
  const currentKey =
    tokenA && tokenB && fee !== null
      ? `${String(chainId)}|${tokenA}|${tokenB}|${String(fee)}`
      : null;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!currentKey) return;
    let cancelled = false;
    void api
      .get<ApiRes>(
        `/api/pool-state?tokenA=${tokenA ?? ""}&tokenB=${tokenB ?? ""}&fee=${String(fee)}&chainId=${String(chainId)}`,
      )
      .then((res) => {
        if (cancelled) return;
        setSnapshot({
          key: currentKey,
          data: {
            exists: res.exists,
            sqrtPriceX96: res.sqrtPriceX96 ?? null,
            tick: res.tick ?? null,
          },
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error("Failed to load pool state");
        setSnapshot({ key: currentKey, data: null, error: e });
      });
    return () => {
      cancelled = true;
    };
  }, [currentKey, tokenA, tokenB, fee, chainId]);

  const matches = !!currentKey && snapshot?.key === currentKey;
  return {
    data: matches ? snapshot.data : null,
    error: matches ? snapshot.error : null,
    loading: !!currentKey && !matches,
  };
}
