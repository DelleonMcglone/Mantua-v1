import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import { useCurrentChainId } from "@/lib/chain-context.tsx";
import type { TokenSymbol } from "@/lib/tokens.ts";
import type { FeeTier } from "@/features/liquidity/fee-tiers.ts";
import type { LocalPosition } from "@/features/liquidity/local-positions.ts";
import type { HookName } from "@/features/liquidity/use-create-pool.ts";

/** One position as returned by `GET /api/positions/onchain`. */
interface OnchainPositionWire {
  chainId: number;
  tokenId: string;
  positionManager: `0x${string}`;
  tokenA: TokenSymbol;
  tokenB: TokenSymbol;
  fee: FeeTier;
  hook: HookName | null;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  amountA: string;
  amountB: string;
  fees0: string;
  fees1: string;
}

interface State {
  /** null while loading or on error — callers fall back to the
   *  localStorage breadcrumb so the tab is never blank mid-fetch. */
  data: LocalPosition[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * The connected wallet's open LP positions, read from on-chain
 * PositionManager state via the server. This is the durable source of
 * truth for the Positions tab — unlike the localStorage breadcrumb it
 * survives cache clears, incognito, and a different browser, and shows
 * positions opened from anywhere.
 *
 * Returns rows already shaped as `LocalPosition` so the existing
 * `localPositionToRow` renderer is reused unchanged. `createdAt` is
 * synthesized to preserve the server's newest-first ordering (on-chain
 * has no mint timestamp without a log scan).
 */
export function useOnchainPositions(walletAddress?: string | null): State {
  const chainId = useCurrentChainId();
  const [data, setData] = useState<LocalPosition[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!walletAddress) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void api
      .get<{ positions: OnchainPositionWire[] }>(
        `/api/positions/onchain?chainId=${String(chainId)}`,
      )
      .then((res) => {
        if (cancelled) return;
        const mapped: LocalPosition[] = res.positions.map((p, i) => ({
          chainId: p.chainId as LocalPosition["chainId"],
          tokenId: p.tokenId,
          tokenA: p.tokenA,
          tokenB: p.tokenB,
          fee: p.fee,
          hook: p.hook,
          amountA: p.amountA,
          amountB: p.amountB,
          fees0: p.fees0,
          fees1: p.fees1,
          txHash: "",
          // Preserve server order (newest-first) without a real timestamp.
          createdAt: res.positions.length - i,
          owner: "user",
        }));
        setData(mapped);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load positions");
        setData(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, chainId, tick]);

  const refetch = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  return { data, loading, error, refetch };
}
