import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { MarketPositionRow } from "./portfolio-core.ts";

export interface UseMarketPositions {
  rows: MarketPositionRow[] | null;
  reload: () => void;
}

/**
 * Phase 9 / PF-003, PF-005 — the marked market positions for one address
 * (`GET /api/markets/positions`), for the user's wallet or the agent's.
 * Null until the first load; refetches on the app-wide refresh event.
 */
export function useMarketPositions(address: string | null | undefined): UseMarketPositions {
  const [rows, setRows] = useState<MarketPositionRow[] | null>(null);
  const reload = useCallback(() => {
    if (!address) return;
    api
      .get<{ positions: MarketPositionRow[] }>(`/api/markets/positions?address=${address}`)
      .then((res) => {
        setRows(res.positions);
      })
      .catch(() => {
        setRows([]);
      });
  }, [address]);
  useEffect(() => {
    // reload sets state only inside its .then/.catch (async), never synchronously.
    reload();
    window.addEventListener("mantua:refresh-portfolio", reload);
    return () => {
      window.removeEventListener("mantua:refresh-portfolio", reload);
    };
  }, [reload]);
  return { rows, reload };
}
