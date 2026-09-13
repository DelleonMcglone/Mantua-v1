import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { SettledRow } from "./portfolio-core.ts";

export interface LpEconomicsRow {
  tokenId: string;
  pair: string;
  hook: string | null;
  fee: number;
  amountA: string;
  amountB: string;
  currentValueUsd: number;
  accruedFeesUsd: number;
  depositedUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  liquidityShareBps: number | null;
  since: string | null;
}

export interface PortfolioEconomics {
  lp: LpEconomicsRow[];
  lpTotals: {
    positions: number;
    currentValueUsd: number;
    accruedFeesUsd: number;
    depositedUsd: number;
    pnlUsd: number;
    withoutBasis: number;
  };
  realized: {
    marketRealizedPnlUsd: number;
    marketWinRate: number | null;
    resolvedMarkets: number;
    openCostUsd: number;
    bySource: Record<string, number>;
    lpCollectedUsd: number | null;
  };
}

export interface SettledHistory {
  rows: SettledRow[];
  totals: {
    wins: number;
    losses: number;
    voided: number;
    realizedPnlUsd: number;
    winRate: number | null;
  };
}

export interface UsePortfolioEconomics {
  economics: PortfolioEconomics | null;
  settled: SettledHistory | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Phase 9 / PF-002, PF-007, PF-012 — `GET /api/portfolio/economics` and
 * `GET /api/portfolio/settled` for the connected wallet. Null until loaded;
 * refetches on the app-wide refresh event.
 */
export function usePortfolioEconomics(walletAddress: string | null): UsePortfolioEconomics {
  const [economics, setEconomics] = useState<PortfolioEconomics | null>(null);
  const [settled, setSettled] = useState<SettledHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!walletAddress) {
      setEconomics(null);
      setSettled(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [e, s] = await Promise.all([
        api.get<PortfolioEconomics>("/api/portfolio/economics"),
        api.get<SettledHistory>("/api/portfolio/settled"),
      ]);
      setEconomics(e);
      setSettled(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load portfolio economics");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    // fetchAll sets state after its await; the synchronous setLoading is the
    // intentional load-state reset when the wallet changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
    const onRefresh = () => {
      void fetchAll();
    };
    window.addEventListener("mantua:refresh-portfolio", onRefresh);
    return () => {
      window.removeEventListener("mantua:refresh-portfolio", onRefresh);
    };
  }, [fetchAll]);

  return {
    economics,
    settled,
    loading,
    error,
    refetch: () => {
      void fetchAll();
    },
  };
}
