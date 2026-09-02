import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api, ApiError } from "@/lib/api.ts";

/** Mirrors the server `UnifiedBalanceView`. */
interface UnifiedBalanceResponse {
  provisioned: boolean;
  address?: string;
  totalUsdc?: string;
  breakdown?: { chain: string; amount: string }[];
}

interface DepositResponse {
  txHash: string;
  explorerUrl?: string;
  amount: string;
}

type DepositStatus = "idle" | "depositing" | "success" | "error";

interface DepositState {
  status: DepositStatus;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

interface State {
  data: UnifiedBalanceResponse | null;
  loading: boolean;
  error: string | null;
  deposit: DepositState;
}

/**
 * The agent wallet's Circle Gateway unified (cross-chain) USDC balance, plus a
 * deposit action (source: the agent wallet on Base). Spending out of the
 * unified balance is an Agent command (the `gateway` tool), not a card action.
 */
export function useUnifiedBalance() {
  const { authenticated, ready } = usePrivy();
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
    deposit: { status: "idle" },
  });

  const refetch = useCallback(async () => {
    if (!ready || !authenticated) return;
    // No synchronous setState here (the effect calls this) — only update on
    // resolve/reject so we don't trigger cascading effect renders.
    try {
      const data = await api.get<UnifiedBalanceResponse>("/api/agent/unified-balance");
      setState((s) => ({ ...s, data, loading: false, error: null }));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, [authenticated, ready]);

  // Inline fetch on mount/auth-change. setState lives only in the async
  // callbacks (not synchronously in the effect) to satisfy the hooks rules;
  // `refetch` (above) is for event-driven refreshes after a deposit.
  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    api
      .get<UnifiedBalanceResponse>("/api/agent/unified-balance")
      .then((data) => {
        if (!cancelled) setState((s) => ({ ...s, data, loading: false, error: null }));
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
  }, [ready, authenticated]);

  const deposit = useCallback(
    async (amount: string) => {
      setState((s) => ({ ...s, deposit: { status: "depositing" } }));
      try {
        const res = await api.post<DepositResponse>("/api/agent/unified-balance/deposit", {
          amount,
        });
        setState((s) => ({
          ...s,
          deposit: {
            status: "success",
            txHash: res.txHash,
            ...(res.explorerUrl ? { explorerUrl: res.explorerUrl } : {}),
          },
        }));
        void refetch();
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Deposit failed";
        setState((s) => ({ ...s, deposit: { status: "error", error: msg } }));
      }
    },
    [refetch],
  );

  const resetDeposit = useCallback(() => {
    setState((s) => ({ ...s, deposit: { status: "idle" } }));
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    depositState: state.deposit,
    deposit,
    resetDeposit,
    refetch,
  };
}
