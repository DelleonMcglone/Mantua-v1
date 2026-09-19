import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { ComboTicket } from "./combo-ticket-core.ts";

/** Poll cadence for the mark between fills, as the market positions use. */
export const COMBOS_POLL_MS = 30_000;

export interface ComboLimits {
  platform: { maxLegs: number; maxStakeUsd: number };
  policy: {
    enabled: boolean;
    maxLegs: number;
    maxStakeUsd: number;
    maxOpenExposureUsd: number;
    maxPayoutUsd: number;
    takeProfitBps: number;
    autoManage: boolean;
  };
}

interface CombosResponse {
  tickets: ComboTicket[];
  limits: ComboLimits;
}

/**
 * Task 072 / CB-008 — the signed-in user's combo tickets
 * (`GET /api/combos`), marked at the combo pool price, with the limits
 * the builder shows. Null until the first load; refetches on the
 * app-wide refresh event and on a slow poll.
 */
export function useCombos(enabled: boolean) {
  const [data, setData] = useState<CombosResponse | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    api
      .get<CombosResponse>("/api/combos")
      .then(setData)
      .catch(() => {
        setData((prev) => prev ?? { tickets: [], limits: DEFAULT_LIMITS });
      });
  }, [enabled]);
  useEffect(() => {
    reload();
    window.addEventListener("mantua:refresh-portfolio", reload);
    const timer = setInterval(reload, COMBOS_POLL_MS);
    return () => {
      clearInterval(timer);
      window.removeEventListener("mantua:refresh-portfolio", reload);
    };
  }, [reload]);
  return { tickets: data?.tickets ?? null, limits: data?.limits ?? null, reload };
}

export const DEFAULT_LIMITS: ComboLimits = {
  platform: { maxLegs: 6, maxStakeUsd: 1_000 },
  policy: {
    enabled: true,
    maxLegs: 3,
    maxStakeUsd: 25,
    maxOpenExposureUsd: 100,
    maxPayoutUsd: 1_000,
    takeProfitBps: 8_000,
    autoManage: false,
  },
};
