import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { AnalysisRead } from "./depth-types.ts";

/**
 * Phase 12 (D-003) — the analyst's research for one side of a market
 * (`GET /api/markets/analysis`). Read once per side when the Research
 * section is open; the server caches it for a minute. Loading is derived
 * from the key the last answer was for, so a side switch never shows the
 * other side's result.
 */
export interface MarketAnalysisState {
  read: AnalysisRead | null;
  loading: boolean;
  failed: boolean;
}

interface Answer {
  key: string;
  read: AnalysisRead | null;
  failed: boolean;
}

export function useMarketAnalysis(
  providerEventId: string,
  outcomeIndex: 0 | 1,
): MarketAnalysisState {
  const key = `${providerEventId}:${String(outcomeIndex)}`;
  const [answer, setAnswer] = useState<Answer>({ key: "", read: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    api
      .get<AnalysisRead>(
        `/api/markets/analysis?providerEventId=${encodeURIComponent(providerEventId)}&outcomeIndex=${String(outcomeIndex)}`,
      )
      .then((read) => {
        if (!cancelled) setAnswer({ key, read, failed: read.status !== "ok" });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ key, read: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, providerEventId, outcomeIndex]);

  const current = answer.key === key;
  return {
    read: current ? answer.read : null,
    loading: !current,
    failed: current && answer.failed,
  };
}
