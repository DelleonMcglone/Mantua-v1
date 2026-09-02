import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.ts";
import { type TokenSymbol } from "@/lib/tokens.ts";
import type { ChartRange } from "./types.ts";

/** One sample of the pair exchange rate (quote priced in base). */
export interface PairRatePoint {
  /** Unix seconds. */
  time: number;
  value: number;
}

interface PairChartResponse {
  base: string;
  quote: string;
  points: PairRatePoint[];
}

interface State {
  points: PairRatePoint[];
  loading: boolean;
  error: string | null;
}

/** Internal state keyed by the request it resolved for, so we can tell
 *  "not loaded yet" from "loaded but empty" without a synchronous setState
 *  in the effect (which the lint rules forbid). */
interface Resolved {
  points: PairRatePoint[];
  error: string | null;
  loadedKey: string;
}

const cache = new Map<string, { points: PairRatePoint[]; fetchedAt: number }>();
const TTL_MS = 60_000;

/**
 * Historical pair exchange rate (`quote` priced in `base`) for the pool detail
 * chart, from `GET /api/pair-price-chart`. Caches per base+quote+range with a
 * 60s TTL so toggling the range back and forth doesn't re-hit the API.
 */
export function usePairPriceChart(
  base: TokenSymbol | null,
  quote: TokenSymbol | null,
  range: ChartRange,
): State {
  const key = base && quote ? `${base}/${quote}/${range}` : "";
  const [state, setState] = useState<Resolved>(() => {
    const c = key ? cache.get(key) : undefined;
    if (c && Date.now() - c.fetchedAt < TTL_MS) {
      return { points: c.points, error: null, loadedKey: key };
    }
    return { points: [], error: null, loadedKey: "" };
  });

  useEffect(() => {
    if (!base || !quote) return;
    const reqKey = `${base}/${quote}/${range}`;
    let cancelled = false;
    void api
      .get<PairChartResponse>(
        `/api/pair-price-chart?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(
          quote,
        )}&range=${range}`,
      )
      .then((data) => {
        if (cancelled) return;
        cache.set(reqKey, { points: data.points, fetchedAt: Date.now() });
        setState({ points: data.points, error: null, loadedKey: reqKey });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setState({ points: [], error: msg, loadedKey: reqKey });
      });
    return () => {
      cancelled = true;
    };
  }, [base, quote, range]);

  // Results are only valid for the current request; while a new key is in
  // flight we report loading and hide stale points from a prior key.
  const matched = state.loadedKey === key;
  return {
    points: matched ? state.points : [],
    error: matched ? state.error : null,
    loading: key !== "" && !matched,
  };
}
