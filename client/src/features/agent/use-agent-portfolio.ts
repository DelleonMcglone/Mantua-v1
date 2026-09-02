import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import { ApiError, api } from "@/lib/api.ts";
import type { TokenSymbol } from "@/lib/tokens.ts";

interface AgentBalance {
  symbol: TokenSymbol;
  address: `0x${string}`;
  decimals: number;
  balanceRaw: string;
  usdValue: number;
}

interface AgentTransaction {
  id: string;
  walletAddress: string;
  txHash: string | null;
  kind: string;
  status: string;
  createdAt: string;
}

/** One of the agent wallet's open LP positions (read live on-chain). */
export interface AgentPosition {
  tokenId: string;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: number;
  hook: string | null;
  amountA: string;
  amountB: string;
  fees0: string;
  fees1: string;
}

interface AgentPortfolioResponse {
  address: string;
  balances: AgentBalance[];
  positions: AgentPosition[];
  transactions: AgentTransaction[];
}

export interface AgentPortfolioState {
  /** Agent wallet address (Circle on Base), or null until provisioned. */
  agentAddress: string | null;
  balances: AgentBalance[];
  positions: AgentPosition[];
  loading: boolean;
  /** True when the user has no agent wallet yet — distinct from a hard
   *  error so the UI can offer "Create agent wallet" instead of red text. */
  notProvisioned: boolean;
  error: string | null;
}

const POLL_MS = 30_000;

/**
 * Live agent-wallet portfolio polling. Mirrors `usePortfolio` but hits
 * `/api/agent/portfolio`, which 404s with code `AGENT_WALLET_NOT_FOUND`
 * for users who haven't provisioned a Circle agent wallet yet.
 */
export function useAgentPortfolio(): AgentPortfolioState {
  const { authenticated, ready } = usePrivy();
  const chainId = useCurrentChainId();
  const [state, setState] = useState<AgentPortfolioState>({
    agentAddress: null,
    balances: [],
    positions: [],
    loading: false,
    notProvisioned: false,
    error: null,
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
    if (!ready || !authenticated) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const data = await api.get<AgentPortfolioResponse>(
          `/api/agent/portfolio?chainId=${String(chainId)}`,
        );
        if (cancelled) return;
        setState({
          agentAddress: data.address,
          balances: data.balances,
          positions: data.positions,
          loading: false,
          notProvisioned: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "AGENT_WALLET_NOT_FOUND") {
          setState({
            agentAddress: null,
            balances: [],
            positions: [],
            loading: false,
            notProvisioned: true,
            error: null,
          });
          return;
        }
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

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authenticated, ready, refreshNonce, chainId]);

  if (!ready || !authenticated) {
    return {
      agentAddress: null,
      balances: [],
      positions: [],
      loading: false,
      notProvisioned: false,
      error: null,
    };
  }

  return state;
}
