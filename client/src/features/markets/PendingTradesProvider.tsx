/* eslint-disable react-refresh/only-export-components -- provider + its hook co-located by design (the use-confirmed-action pattern). */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "@/lib/api.ts";
import {
  PENDING_POLL_MS,
  PENDING_TRADES_STORAGE_KEY,
  disposePending,
  parsePendingTrades,
  pendingForWallet,
  removePending,
  serializePendingTrades,
  upsertPending,
  type PendingTrade,
  type TradeTxState,
} from "./trade-status-core.ts";

/**
 * Phase 7 / R-004 — the pending-trade register.
 *
 * Every trade the wallet signs is written here the moment its hash exists
 * and removed only on a server-verified terminal state. So a reload, a
 * closed tab, or a dropped RPC between "signed" and "confirmed" loses
 * nothing: on the next load the register resumes, asks the server
 * (`GET /api/markets/trade/status`) until the chain answers, re-reports a
 * fill the server is missing, and surfaces the outcome. Persisted in
 * localStorage (best-effort: a blocked store degrades to in-memory).
 */

export interface SettledTrade {
  trade: PendingTrade;
  outcome: "confirmed" | "failed" | "dropped";
  settledAt: number;
}

interface PendingTradesContextValue {
  /** Pending trades for the connected wallet, newest first. */
  pending: PendingTrade[];
  /** Outcomes resolved by the resume loop, until dismissed. */
  settled: SettledTrade[];
  /** Whether the oldest pending trade has been waiting past the slow threshold. */
  slow: boolean;
  add: (trade: PendingTrade) => void;
  remove: (txHash: string) => void;
  dismiss: (txHash: string) => void;
}

const PendingTradesContext = createContext<PendingTradesContextValue>({
  pending: [],
  settled: [],
  slow: false,
  add: () => undefined,
  remove: () => undefined,
  dismiss: () => undefined,
});

function load(): PendingTrade[] {
  try {
    return parsePendingTrades(localStorage.getItem(PENDING_TRADES_STORAGE_KEY));
  } catch {
    return [];
  }
}

function save(trades: readonly PendingTrade[]): void {
  try {
    localStorage.setItem(PENDING_TRADES_STORAGE_KEY, serializePendingTrades(trades));
  } catch {
    // Storage blocked (private mode, quota): the in-memory list still works.
  }
}

interface StatusAnswer {
  state: TradeTxState;
  recorded: boolean;
}

export function PendingTradesProvider({ children }: { children: ReactNode }) {
  const { user, authenticated } = usePrivy();
  const wallet = authenticated ? (user?.wallet?.address ?? null) : null;
  const [all, setAll] = useState<PendingTrade[]>(() => load());
  const [settled, setSettled] = useState<SettledTrade[]>([]);
  const [slow, setSlow] = useState(false);

  const add = useCallback((trade: PendingTrade) => {
    setAll((prev) => {
      const next = upsertPending(prev, trade);
      save(next);
      return next;
    });
  }, []);
  const remove = useCallback((txHash: string) => {
    setAll((prev) => {
      const next = removePending(prev, txHash);
      save(next);
      return next;
    });
  }, []);
  const dismiss = useCallback((txHash: string) => {
    setSettled((prev) => prev.filter((s) => s.trade.txHash.toLowerCase() !== txHash.toLowerCase()));
  }, []);

  const pending = useMemo(() => (wallet ? pendingForWallet(all, wallet) : []), [all, wallet]);

  // The resume loop: while anything is pending for this wallet, ask the
  // server every PENDING_POLL_MS and act on the answer.
  useEffect(() => {
    if (!wallet || pending.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous reset when nothing is pending.
      setSlow(false);
      return;
    }
    // Object-held so the checks after each await re-read it (TS narrows a
    // bare `let` flag to its initializer inside the closure).
    const run = { cancelled: false };
    const isCancelled = (): boolean => run.cancelled;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (trade: PendingTrade, outcome: SettledTrade["outcome"]): void => {
      remove(trade.txHash);
      setSettled((prev) => [{ trade, outcome, settledAt: Date.now() }, ...prev].slice(0, 5));
      if (outcome === "confirmed") window.dispatchEvent(new Event("mantua:refresh-portfolio"));
    };

    const tick = async (): Promise<void> => {
      let anySlow = false;
      for (const trade of pending) {
        if (isCancelled()) return;
        let answer: StatusAnswer;
        try {
          answer = await api.get<StatusAnswer>(
            `/api/markets/trade/status?txHash=${trade.txHash}&chainId=${String(trade.chainId)}`,
          );
        } catch {
          continue; // unreachable server: keep waiting, the banner says why
        }
        if (isCancelled()) return;
        const disposition = disposePending(trade, answer, Date.now());
        switch (disposition.kind) {
          case "keep":
            if (disposition.slow) anySlow = true;
            break;
          case "confirmed":
            if (disposition.needsFillReport) {
              // The server verifies the receipt before believing the report;
              // a failure here just leaves it for the next tick.
              try {
                await api.post("/api/markets/fills", {
                  chainId: trade.chainId,
                  txHash: trade.txHash,
                  marketId: trade.marketId,
                  direction: trade.direction,
                  tokensRaw: trade.tokensRaw,
                  usdcRaw: trade.usdcRaw,
                });
              } catch {
                continue;
              }
            }
            settle(trade, "confirmed");
            break;
          case "failed":
            settle(trade, "failed");
            break;
          case "dropped":
            settle(trade, "dropped");
            break;
        }
      }
      if (!isCancelled()) {
        setSlow(anySlow);
        timer = setTimeout(() => void tick(), PENDING_POLL_MS);
      }
    };
    void tick();
    return () => {
      run.cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [wallet, pending, remove]);

  const value = useMemo<PendingTradesContextValue>(
    () => ({ pending, settled, slow, add, remove, dismiss }),
    [pending, settled, slow, add, remove, dismiss],
  );
  return <PendingTradesContext.Provider value={value}>{children}</PendingTradesContext.Provider>;
}

export function usePendingTrades(): PendingTradesContextValue {
  return useContext(PendingTradesContext);
}
