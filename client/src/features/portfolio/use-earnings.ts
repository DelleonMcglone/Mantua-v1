import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { EarningsData } from "./earnings.ts";

export interface UseEarnings {
  data: EarningsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch the connected wallet's REAL uncollected fee earnings from
 * `GET /api/earnings` (read live from v4 on-chain state). Null until a wallet
 * is connected. Re-poll via `refetch()` after a sweep.
 */
export function useEarnings(walletAddress: string | null): UseEarnings {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEarnings = useCallback(async () => {
    if (!walletAddress) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<EarningsData>("/api/earnings");
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load earnings");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    // fetchEarnings sets state asynchronously after its await; the initial
    // synchronous setLoading is an intentional load-state reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchEarnings();
  }, [fetchEarnings]);

  return {
    data,
    loading,
    error,
    refetch: () => {
      void fetchEarnings();
    },
  };
}
