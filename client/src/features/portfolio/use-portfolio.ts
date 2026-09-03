import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ApiError, api } from "@/lib/api.ts";
import { getTokens, type Token, type TokenSymbol } from "@/lib/tokens.ts";
import { BASE_CHAIN_ID, type SupportedChainId } from "@/lib/chains.ts";

interface PortfolioBalance {
  symbol: TokenSymbol;
  address: `0x${string}`;
  decimals: number;
  balanceRaw: string;
  usdValue: number;
}

export interface PortfolioTransaction {
  id: string;
  action: string;
  txHash: string;
  chainId: number;
  /** Action-specific shape (tokenIn/tokenOut for swap, tokenA/tokenB
   *  for liquidity, token for send_tokens, etc.). Treated as opaque
   *  by most consumers; AssetDetailPanel walks it to filter by symbol. */
  params: Record<string, unknown>;
  outcome: string;
  usdValue: string | null;
  createdAt: string;
}

interface PortfolioResponse {
  address: string;
  balances: PortfolioBalance[];
  transactions?: PortfolioTransaction[];
}

interface PortfolioState {
  balances: PortfolioBalance[];
  transactions: PortfolioTransaction[];
  loading: boolean;
  error: string | null;
  walletAddress: string | null;
}

const POLL_MS = 15_000;

/**
 * Live portfolio polling. Returns the real on-chain balances for the
 * connected Privy wallet on Base (or null until login). Polls
 * `/api/portfolio` every 15s so balances update without requiring a
 * full page refresh after the user receives more tokens.
 */
export function usePortfolio(): PortfolioState {
  const { authenticated, ready, user } = usePrivy();
  const chainId = BASE_CHAIN_ID;
  const wallet = user?.wallet?.address ?? null;
  const [state, setState] = useState<PortfolioState>({
    balances: [],
    transactions: [],
    loading: false,
    error: null,
    walletAddress: null,
  });
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const handler = () => {
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener("mantua:refresh-portfolio", handler);
    return () => {
      window.removeEventListener("mantua:refresh-portfolio", handler);
    };
  }, []);

  useEffect(() => {
    if (!ready || !authenticated || !wallet) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronous reset to the disconnected state.
      setState({
        balances: [],
        transactions: [],
        loading: false,
        error: null,
        walletAddress: null,
      });
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const data = await api.get<PortfolioResponse>(`/api/portfolio?chainId=${String(chainId)}`);
        if (cancelled) return;
        setState({
          balances: data.balances,
          transactions: data.transactions ?? [],
          loading: false,
          error: null,
          walletAddress: data.address,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error";
        setState((s) => ({ ...s, loading: false, error: message }));
      } finally {
        if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS);
      }
    };

    setState((s) => ({ ...s, loading: true, walletAddress: wallet }));
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authenticated, ready, wallet, refreshNonce, chainId]);

  return state;
}

export interface DisplayAsset {
  symbol: TokenSymbol;
  name: string;
  /** Human-readable balance (e.g. "1.234"). */
  qty: string;
  /** USD value formatted (e.g. "$3,250.00"). */
  val: string;
  /** Unit price (e.g. "$1.00"). */
  price: string;
  /** 24h percent change (placeholder until we wire a price feed). */
  pct: number;
  /** Raw on-chain balance (string of base units). */
  balanceRaw: string;
  decimals: number;
}

export function toDisplayAssets(
  balances: PortfolioBalance[],
  chainId: SupportedChainId,
): DisplayAsset[] {
  const tokens = getTokens(chainId);
  return balances.map((b) => {
    // `b.symbol` is a balance symbol that may not be in the registry, so
    // the lookup can miss — widen to `| undefined` for the `?? b.symbol`.
    const meta = tokens[b.symbol] as Token | undefined;
    const qtyNum = Number(b.balanceRaw) / Math.pow(10, b.decimals);
    const unitPrice = qtyNum > 0 ? b.usdValue / qtyNum : 0;
    return {
      symbol: b.symbol,
      name: meta?.name ?? b.symbol,
      qty: formatQty(qtyNum, b.decimals),
      val: formatUsd(b.usdValue),
      price: unitPrice > 0 ? formatUsd(unitPrice) : "—",
      pct: 0,
      balanceRaw: b.balanceRaw,
      decimals: b.decimals,
    };
  });
}

function formatQty(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "0.00";
  if (value === 0) return "0.00";
  const dp = decimals === 6 ? 2 : decimals === 8 ? 6 : 4;
  return value.toLocaleString(undefined, { maximumFractionDigits: dp });
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  if (value < 0.01) return "<$0.01";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
