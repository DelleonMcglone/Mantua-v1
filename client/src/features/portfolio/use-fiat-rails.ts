import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api.ts";

export type FiatTransferStatus = "pending" | "complete" | "failed";
export interface FiatTransfer {
  id: string;
  kind: "deposit" | "withdraw";
  amountUsd: string;
  status: FiatTransferStatus;
  createdAt: string;
  updatedAt: string;
  message: string;
  recoveryAction?: "retry" | "contact_support";
}
interface FiatRailState {
  mode: "disabled" | "sandbox" | "live";
  bankLinked: boolean;
  transfers: FiatTransfer[];
}

/** User-facing fiat rail state. No wallet addresses, networks, or provider
 * credentials cross this boundary; users only see dollars and clear status. */
export function useFiatRails() {
  const [data, setData] = useState<FiatRailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<FiatRailState>("/api/fiat-rails");
      setData(next);
      setError(null);
    } catch (err) {
      // An unauthenticated Assets card is normal; don't show an API error.
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(err instanceof Error ? err.message : "Couldn’t load cash activity.");
      }
    }
  }, []);

  useEffect(() => {
    // Schedule the initial fetch after the effect commits; React's lint rule
    // correctly rejects a state-setting async call directly in an effect body.
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const linkBank = useCallback(async () => {
    setWorking(true);
    try {
      await api.post("/api/fiat-rails/bank-link", {});
      await refresh();
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  const move = useCallback(
    async (kind: "deposit" | "withdraw", amountUsd: string) => {
      setWorking(true);
      try {
        await api.post(`/api/fiat-rails/${kind}s`, { amountUsd });
        await refresh();
      } finally {
        setWorking(false);
      }
    },
    [refresh],
  );

  return { data, error, working, linkBank, move, refresh };
}
