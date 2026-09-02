import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ApiError, api } from "@/lib/api.ts";

export type HistoryRange = "1H" | "1D" | "TW" | "1M" | "1Y";

interface HistoryPoint {
  ts: number;
  value: number;
}

export interface PortfolioHistory {
  range: HistoryRange;
  series: HistoryPoint[];
  startValue: number;
  endValue: number;
  delta: number;
  pct: number;
}

interface State {
  data: PortfolioHistory | null;
  loading: boolean;
  error: string | null;
}

const IDLE: State = { data: null, loading: false, error: null };

/**
 * Fetch the portfolio value time series for `range`. Refetches when
 * the range or auth state changes. Returns an idle placeholder while
 * disconnected so the card can render a fallback rather than an
 * empty chart.
 *
 * State updates only happen inside the async fetch callbacks (success
 * / failure), keeping us clear of `react-hooks/set-state-in-effect`.
 * The disconnected view is derived synchronously in the return.
 */
export function usePortfolioHistory(range: HistoryRange): State {
  const { authenticated, ready } = usePrivy();
  const enabled = ready && authenticated;
  const [state, setState] = useState<State>(IDLE);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void api
      .get<PortfolioHistory>(`/api/portfolio/history?range=${range}`)
      .then((data) => {
        if (cancelled) return;
        setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setState({ data: null, loading: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, range]);

  if (!enabled) return IDLE;
  if (state.data === null && state.error === null) {
    return { data: null, loading: true, error: null };
  }
  return state;
}
