import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { MarketPoolsResponse } from "./market-pools.ts";

interface MarketPoolsState {
  data: MarketPoolsResponse | null;
  loading: boolean;
}

const EMPTY: MarketPoolsResponse = { marketsDeployed: false, pools: [] };

/**
 * B7-006 — the pool list's market join, from GET /api/markets/pools.
 * Best-effort by design: a fetch failure resolves to the empty join
 * (no market column, market-pool actions gated) rather than an error —
 * the pool list must render either way, and "no markets" is the safe
 * degradation for both consumers.
 */
export function useMarketPools(): MarketPoolsState {
  const [state, setState] = useState<MarketPoolsState>({ data: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    void api
      .get<MarketPoolsResponse>("/api/markets/pools")
      .then((res) => {
        if (cancelled) return;
        setState({ data: res, loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ data: EMPTY, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
