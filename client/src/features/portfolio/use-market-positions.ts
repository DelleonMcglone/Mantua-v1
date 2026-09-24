import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { MarketPositionRow } from "./portfolio-core.ts";
import { onUserPositions } from "./user-stream-bus.ts";
import { frameIsFor } from "./user-stream-core.ts";

/** Poll cadence for the mark-to-market between fills (T-007). */
export const POSITIONS_POLL_MS = 30_000;

export interface UseMarketPositions {
  rows: MarketPositionRow[] | null;
  reload: () => void;
}

/**
 * Phase 9 / PF-003, PF-005 — the marked market positions for one address
 * (`GET /api/markets/positions`), for the user's wallet or the agent's.
 * Null until the first load; refetches on the app-wide refresh event and
 * on a slow poll (T-007: fills dispatch the event, the poll covers price
 * moves between fills so the mark-to-market stays live). R-001: when an
 * open signed-in stream pushes `positions` for this address, they apply
 * at once; the agent's wallet never arrives on the user's stream and
 * keeps polling.
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
    const timer = setInterval(reload, POSITIONS_POLL_MS);
    const unsubscribe = onUserPositions((frame) => {
      if (frameIsFor(frame, address)) setRows(frame.positions);
    });
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("mantua:refresh-portfolio", reload);
    };
  }, [reload, address]);
  return { rows, reload };
}
