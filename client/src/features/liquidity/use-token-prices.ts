import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.ts";
import { type TokenSymbol } from "@/lib/tokens.ts";

interface PricesResponse {
  prices: Record<string, number>;
}

interface State {
  prices: Record<string, number>;
  loading: boolean;
  error: string | null;
}

const cache = new Map<string, { value: number; fetchedAt: number }>();
const TTL_MS = 60_000;

/**
 * USD spot prices for a stable list of token symbols. Caches per
 * symbol with a 60s TTL so flipping the pair back and forth in the
 * create-pool form doesn't re-hit the API. CoinGecko upstream;
 * unavailable prices come back as 0 (caller skips mirror).
 */
export function useTokenPrices(symbols: TokenSymbol[]): State {
  const key = [...symbols].sort().join(",");
  const [state, setState] = useState<State>(() => {
    const initial: Record<string, number> = {};
    let allCached = symbols.length > 0;
    for (const s of symbols) {
      const c = cache.get(s);
      if (c && Date.now() - c.fetchedAt < TTL_MS) initial[s] = c.value;
      else allCached = false;
    }
    return { prices: initial, loading: !allCached && symbols.length > 0, error: null };
  });

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    void api
      .get<PricesResponse>(`/api/token-prices?symbols=${encodeURIComponent(key)}`)
      .then((data) => {
        if (cancelled) return;
        const now = Date.now();
        for (const [s, v] of Object.entries(data.prices)) {
          cache.set(s, { value: v, fetchedAt: now });
        }
        setState({ prices: data.prices, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setState((s) => ({ ...s, loading: false, error: msg }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, symbols]);

  return state;
}
