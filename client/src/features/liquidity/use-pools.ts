import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api.ts";
import { TOKENS, isTokenSymbol } from "@/lib/tokens.ts";
import { FEE_TIERS, FEE_TIER_LABELS, type FeeTier } from "./fee-tiers.ts";
import type { PoolDetail, PoolSummary, ChartRange } from "./types.ts";

const LOCAL_PREFIX = "local:";

/**
 * Synthesize a `PoolDetail` for a locally-created pool. The server's
 * `/api/pools/:id` only knows about DefiLlama-indexed mainnet pools, so for
 * `local:*` IDs we build the detail client-side. The id itself encodes the
 * whole pool key — `local:<chainId>|<tokenA>|<tokenB>|<fee>|<hook|none>` — so
 * we parse it directly instead of requiring a matching localStorage entry
 * (which broke position click-through on cleared storage, other devices, and
 * agent-created pools). TVL/volume/APY aren't tracked locally — zeros.
 */
function synthesizeLocalPool(poolId: string): PoolDetail | null {
  const key = poolId.slice(LOCAL_PREFIX.length);
  const [, tokenA, tokenB, feeStr] = key.split("|");
  if (!tokenA || !tokenB || !isTokenSymbol(tokenA) || !isTokenSymbol(tokenB)) return null;
  const feeNum = Number(feeStr);
  const fee: FeeTier | null = (FEE_TIERS as readonly number[]).includes(feeNum)
    ? (feeNum as FeeTier)
    : null;
  if (fee === null) return null;
  const underlying: string[] = [TOKENS[tokenA].address, TOKENS[tokenB].address];
  return {
    pool: {
      id: poolId,
      symbol: `${tokenA}-${tokenB}`,
      project: "mantua",
      feeTier: FEE_TIER_LABELS[fee],
      tvlUsd: 0,
      apy: 0,
      volumeUsd1d: 0,
      volumeUsd7d: 0,
      underlyingTokens: underlying,
    },
    chart: [],
  };
}

interface ListState {
  data: PoolSummary[] | null;
  error: ApiError | Error | null;
  loading: boolean;
}

export function usePools(): ListState {
  const [state, setState] = useState<ListState>({ data: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ pools: PoolSummary[] }>("/api/pools")
      .then((res) => {
        if (cancelled) return;
        setState({ data: res.pools, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error("Failed to load pools");
        setState({ data: null, error: e, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

interface DetailState {
  data: PoolDetail | null;
  error: ApiError | Error | null;
  loading: boolean;
}

export function usePool(poolId: string, range: ChartRange): DetailState {
  const [state, setState] = useState<DetailState>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    if (poolId.startsWith(LOCAL_PREFIX)) {
      void Promise.resolve().then(() => {
        if (cancelled) return;
        const synth = synthesizeLocalPool(poolId);
        setState(
          synth
            ? { data: synth, error: null, loading: false }
            : { data: null, error: new Error("Pool not found locally"), loading: false },
        );
      });
      return () => {
        cancelled = true;
      };
    }
    void api
      .get<PoolDetail>(`/api/pools/${poolId}?range=${range}`)
      .then((res) => {
        if (cancelled) return;
        setState({ data: res, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error("Failed to load pool");
        setState({ data: null, error: e, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [poolId, range]);

  return state;
}
