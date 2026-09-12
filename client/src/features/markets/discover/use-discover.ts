import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { DiscoverMarket } from "../discovery.ts";

/** Mirrors the server's `DiscoverRead` (lib/sports/market-discover.ts). */
interface DiscoverResponse {
  markets: DiscoverMarket[];
  fetchedAt: number;
  dataAsOf?: number;
  delayed: boolean;
  unavailable: string[];
}

export interface DiscoverState {
  markets: DiscoverMarket[];
  fetchedAt: number | undefined;
  dataAsOf: number | undefined;
  delayed: boolean;
  loading: boolean;
  error: boolean;
}

const REFRESH_MS = 60_000;

/**
 * The id-free discover read across the covered leagues, refreshed once a
 * minute (T-018). Filtering and sorting happen client-side in
 * `applyDiscoverFilters` so a phrase and a tap share one code path.
 */
export function useDiscover(league?: string): DiscoverState {
  const [state, setState] = useState<DiscoverState>({
    markets: [],
    fetchedAt: undefined,
    dataAsOf: undefined,
    delayed: false,
    loading: true,
    error: false,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const query = league ? `?league=${encodeURIComponent(league)}` : "";
        const res = await api.get<DiscoverResponse>(`/api/markets/discover${query}`);
        if (cancelled) return;
        setState({
          markets: res.markets,
          fetchedAt: res.fetchedAt,
          dataAsOf: res.dataAsOf,
          delayed: res.delayed,
          loading: false,
          error: false,
        });
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, error: true }));
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [league]);

  return state;
}
