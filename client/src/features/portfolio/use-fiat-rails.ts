import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api.ts";
import type { FiatTransferStatus } from "./fiat-status.ts";

export type { FiatTransferStatus };
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
  /** Real Plaid Link is available (the server can mint link tokens). */
  plaidReady: boolean;
  /** Display-safe bank label, e.g. "First Platypus Bank ••1234". */
  bankLabel: string | null;
  transfers: FiatTransfer[];
}

/** User-facing fiat rail state. No wallet addresses, networks, or provider
 * credentials cross this boundary; users only see dollars and clear status.
 * Bank linking uses the real Plaid Link flow when the server offers it
 * (`plaidReady`), and the deterministic sandbox link otherwise. */
export function useFiatRails() {
  const [data, setData] = useState<FiatRailState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);

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

  /** Sandbox bank link (no Plaid credentials configured server-side). */
  const linkBank = useCallback(async () => {
    setWorking(true);
    try {
      await api.post("/api/fiat-rails/bank-link", {});
      await refresh();
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  /** F-002 — start the real Plaid Link flow: mint a link token server-side. */
  const startPlaidLink = useCallback(async () => {
    setWorking(true);
    try {
      const res = await api.post<{ linkToken: string }>("/api/fiat/link-token", {});
      setLinkToken(res.linkToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t start the bank connection.");
      setWorking(false);
    }
  }, []);

  /** F-002 — Link succeeded: hand the short-lived public token to the
   * server, which exchanges it and creates the provider accounts. Bank
   * details never pass through the browser beyond this opaque token. */
  const completePlaidLink = useCallback(
    async (publicToken: string) => {
      try {
        await api.post("/api/fiat/exchange", { publicToken });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "We couldn’t connect your bank.");
      } finally {
        setLinkToken(null);
        setWorking(false);
      }
    },
    [refresh],
  );

  const cancelPlaidLink = useCallback(() => {
    setLinkToken(null);
    setWorking(false);
  }, []);

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

  return {
    data,
    error,
    working,
    linkToken,
    linkBank,
    startPlaidLink,
    completePlaidLink,
    cancelPlaidLink,
    move,
    refresh,
  };
}
