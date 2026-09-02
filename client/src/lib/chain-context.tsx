/* eslint-disable react-refresh/only-export-components -- context module: Provider component + useCurrentChainId/useChainContext hooks live together. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  DEFAULT_CHAIN_ID,
  isSupportedChainId,
  type SupportedChainId,
} from "./chains.ts";

interface ChainContextValue {
  /** Currently active chain for all reads/writes (Base Mainnet). */
  chainId: SupportedChainId;
  /** Switch the app + connected wallet to a supported chain. */
  setChainId: (id: SupportedChainId) => Promise<void>;
  /** True while a `wallet.switchChain` call is in flight (user
   *  approval dialog open in their wallet). */
  switching: boolean;
}

const ChainContext = createContext<ChainContextValue | null>(null);

const STORAGE_KEY = "mantua.selectedChainId";

function readStoredChainId(): SupportedChainId {
  if (typeof window === "undefined") return DEFAULT_CHAIN_ID;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHAIN_ID;
    const n = Number(raw);
    if (isSupportedChainId(n)) return n;
    return DEFAULT_CHAIN_ID;
  } catch {
    return DEFAULT_CHAIN_ID;
  }
}

function hasStoredChainId(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw !== null && isSupportedChainId(Number(raw));
  } catch {
    return false;
  }
}

/**
 * Provider for the active chain (Base Mainnet — the single supported
 * chain). Drives the per-chain token list, the chainId param sent on
 * pool-create / add-liquidity / swap requests, and the wallet's chain
 * via `wallet.switchChain`.
 */
export function ChainProvider({ children }: { children: React.ReactNode }) {
  const { wallets } = useWallets();
  const [chainId, setChainIdState] = useState<SupportedChainId>(() => readStoredChainId());
  const [switching, setSwitching] = useState(false);
  // Once the user has an explicit selection (stored, or picked this
  // session), the selector is the source of truth and the wallet-mirror
  // effect below stops overriding it — otherwise a slow/failed
  // `switchChain` snaps the UI back to the wallet's old chain.
  const userSelectedRef = useRef<boolean>(hasStoredChainId());

  // Pick the wallet the user is connected through. Privy's first entry
  // is the primary; same convention used elsewhere in the codebase.
  const wallet = useMemo(() => {
    return wallets.find((w) => w.walletClientType === "privy") ?? wallets.at(0);
  }, [wallets]);

  // Initial sync only: with no explicit selection, adopt the wallet's
  // chain so the selector reflects reality. After a user pick, the
  // selection drives the wallet — not the other way round.
  useEffect(() => {
    if (userSelectedRef.current) return;
    if (!wallet?.chainId) return;
    const eip = wallet.chainId.startsWith("eip155:")
      ? Number(wallet.chainId.slice("eip155:".length))
      : Number(wallet.chainId);
    if (isSupportedChainId(eip)) {
      // Mirroring the wallet's externally-controlled chain into React
      // state is exactly the external-system sync an effect is for.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChainIdState(eip);
    }
  }, [wallet?.chainId]);

  const setChainId = useCallback(
    async (next: SupportedChainId) => {
      // Single-chain today (SupportedChainId is only Base Mainnet), so this
      // guard is currently always taken; it stays for when a second chain
      // returns to the union.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (next === chainId) return;
      userSelectedRef.current = true;
      if (!wallet) {
        // No wallet yet — just remember the selection; we'll switch
        // once the user connects.
        setChainIdState(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, String(next));
        } catch {
          // localStorage failures (quota, private mode) are non-fatal —
          // the selection still drives the in-memory context.
        }
        return;
      }
      setSwitching(true);
      try {
        await wallet.switchChain(next);
        setChainIdState(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, String(next));
        } catch {
          // localStorage failures (quota, private mode) are non-fatal —
          // the selection still drives the in-memory context.
        }
      } catch (err) {
        // User rejected or wallet doesn't support the chain — leave
        // selection unchanged. Wallet surfaces its own error toast.
        void err;
      } finally {
        setSwitching(false);
      }
    },
    [chainId, wallet],
  );

  const value = useMemo<ChainContextValue>(
    () => ({ chainId, setChainId, switching }),
    [chainId, setChainId, switching],
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useCurrentChainId(): SupportedChainId {
  const ctx = useContext(ChainContext);
  if (!ctx) {
    // Sensible fallback outside the provider — keeps tests + storybook
    // happy and means non-provider code paths default to Base Mainnet.
    return DEFAULT_CHAIN_ID;
  }
  return ctx.chainId;
}

export function useChainSwitch(): ChainContextValue {
  const ctx = useContext(ChainContext);
  if (!ctx) {
    throw new Error("useChainSwitch must be used inside <ChainProvider>");
  }
  return ctx;
}
