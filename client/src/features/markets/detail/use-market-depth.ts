import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { MarketDepthRead } from "./depth-types.ts";

/**
 * Phase 12 — the market page's deeper read (`GET /api/markets/depth`),
 * refreshed every 20 s while the game is live and once a minute otherwise.
 * A failed read leaves the last good one in place and flags it.
 */
export interface MarketDepthState {
  read: MarketDepthRead | null;
  failed: boolean;
}

const LIVE_MS = 20_000;
const IDLE_MS = 60_000;

export function useMarketDepth(providerEventId: string, live: boolean): MarketDepthState {
  const [state, setState] = useState<MarketDepthState>({ read: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const read = await api.get<MarketDepthRead>(
          `/api/markets/depth?providerEventId=${encodeURIComponent(providerEventId)}`,
        );
        if (!cancelled) setState({ read, failed: false });
      } catch {
        if (!cancelled) setState((prev) => ({ read: prev.read, failed: true }));
      }
    };
    void load();
    const timer = setInterval(() => void load(), live ? LIVE_MS : IDLE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [providerEventId, live]);

  return state;
}
