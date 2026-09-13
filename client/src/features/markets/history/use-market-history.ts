import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { HistoryResponse, HistoryRow } from "../detail/depth-types.ts";

/**
 * Phase 12 (D-007) — resolved markets with outcomes and price paths
 * (`GET /api/markets/history`), for one league or all of them. Loading is
 * derived from the key the last answer was for, so a league switch never
 * shows the previous league's rows as current.
 */
export interface MarketHistoryState {
  rows: HistoryRow[];
  fetchedAt: number | undefined;
  loading: boolean;
  failed: boolean;
}

interface Answer {
  key: string;
  rows: HistoryRow[];
  fetchedAt: number | undefined;
  failed: boolean;
}

export function useMarketHistory(league: string | null, limit: number): MarketHistoryState {
  const key = `${league ?? "all"}:${String(limit)}`;
  const [answer, setAnswer] = useState<Answer>({
    key: "",
    rows: [],
    fetchedAt: undefined,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ limit: String(limit) });
    if (league) query.set("league", league);
    api
      .get<HistoryResponse>(`/api/markets/history?${query.toString()}`)
      .then((res) => {
        if (!cancelled) setAnswer({ key, rows: res.rows, fetchedAt: res.fetchedAt, failed: false });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ key, rows: [], fetchedAt: undefined, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, league, limit]);

  const current = answer.key === key;
  return {
    rows: current ? answer.rows : [],
    fetchedAt: current ? answer.fetchedAt : undefined,
    loading: !current,
    failed: current && answer.failed,
  };
}
