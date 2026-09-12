import { useEffect, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "@/lib/api.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import { selectUsdcRaw, type BalanceRow } from "./live-balance-core.ts";

/**
 * T-007 — one shared live USDC balance for every screen that shows it.
 * A module-level store polls `/api/portfolio` once (not once per mounted
 * component), refreshes on `mantua:refresh-portfolio` (every fill, claim,
 * and withdrawal dispatches it), and every subscriber re-renders together
 * so the ticket and the portfolio can never disagree.
 */
interface Snapshot {
  usdcRaw: string | null;
  updatedAt: number | null;
}

const POLL_MS = 15_000;
let snapshot: Snapshot = { usdcRaw: null, updatedAt: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let active = false;

function emit(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

async function tick() {
  try {
    const data = await api.get<{ balances: BalanceRow[] }>(
      `/api/portfolio?chainId=${String(BASE_CHAIN_ID)}`,
    );
    emit({ usdcRaw: selectUsdcRaw(data.balances), updatedAt: Date.now() });
  } catch {
    // Keep the last good snapshot; the next tick retries.
  } finally {
    if (active) timer = setTimeout(() => void tick(), POLL_MS);
  }
}

function start() {
  if (active) return;
  active = true;
  void tick();
}

function stop() {
  active = false;
  if (timer) clearTimeout(timer);
  timer = null;
  emit({ usdcRaw: null, updatedAt: null });
}

/** Force a refresh now (a fill just landed). */
export function refreshLiveBalance() {
  if (!active) return;
  if (timer) clearTimeout(timer);
  void tick();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

export function useLiveBalance(): Snapshot {
  const { ready, authenticated, user } = usePrivy();
  const wallet = user?.wallet?.address ?? null;
  useEffect(() => {
    if (!ready || !authenticated || !wallet) {
      stop();
      return;
    }
    start();
    window.addEventListener("mantua:refresh-portfolio", refreshLiveBalance);
    return () => {
      window.removeEventListener("mantua:refresh-portfolio", refreshLiveBalance);
      if (listeners.size === 0) stop();
    };
  }, [ready, authenticated, wallet]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
