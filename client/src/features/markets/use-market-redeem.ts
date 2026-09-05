import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import { publicClientFor, useChainWalletClient } from "@/lib/privy/wallet-client.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import type { RedeemableRow } from "./market-redeem-core.ts";

/** Mirrors POST /api/markets/redeem/calldata (server/src/routes/market-redeem.ts). */
interface RedeemCalldata {
  to: `0x${string}`;
  calldata: `0x${string}`;
  state: number;
  functionName: "redeem" | "redeemInvalid";
  payoutRaw: string;
}

export type RedeemPhase =
  | { kind: "idle" }
  | { kind: "preparing"; marketId: string }
  | { kind: "signing"; marketId: string }
  | { kind: "confirming"; marketId: string }
  | { kind: "done"; marketId: string; txHash: `0x${string}` }
  | { kind: "error"; message: string };

/**
 * The caller's claimable positions (C-011 GAP-3). Reloads on the shared
 * portfolio-refresh event so a claim elsewhere on the page clears the row.
 */
export function useRedeemable(address: string | null | undefined) {
  const [rows, setRows] = useState<RedeemableRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Without an address there is nothing to fetch; the consumer renders
  // nothing in that case, so `rows` may simply stay null.
  const reload = useCallback(() => {
    if (!address) return;
    api
      .get<{ redeemable: RedeemableRow[] }>(`/api/markets/redeemable?address=${address}`)
      .then((res) => {
        setRows(res.redeemable);
        setError(null);
      })
      .catch(() => {
        setRows([]);
        setError("Couldn't check for claimable winnings.");
      });
  }, [address]);

  useEffect(() => {
    reload();
    window.addEventListener("mantua:refresh-portfolio", reload);
    return () => {
      window.removeEventListener("mantua:refresh-portfolio", reload);
    };
  }, [reload]);

  return { rows, error, reload };
}

/**
 * Claim one market's winnings: calldata from the server, signed by the
 * USER's wallet (the server holds no keys — same pattern as
 * `use-market-trade.ts`), then trust-but-verify recorded server-side.
 * Redemption needs no approval leg: the market burns the caller's own
 * outcome tokens and pays USDC out.
 */
export function useMarketRedeem(onClaimed?: () => void) {
  const getWallet = useChainWalletClient();
  const chainId = BASE_CHAIN_ID;
  const [phase, setPhase] = useState<RedeemPhase>({ kind: "idle" });

  const claim = async (marketId: string) => {
    if (phase.kind === "preparing" || phase.kind === "signing" || phase.kind === "confirming") {
      return;
    }
    setPhase({ kind: "preparing", marketId });
    try {
      const calldata = await api.post<RedeemCalldata>("/api/markets/redeem/calldata", {
        chainId,
        marketId,
      });
      const wallet = await getWallet();
      if (!wallet) throw new Error("No wallet connected");

      setPhase({ kind: "signing", marketId });
      const txHash = await wallet.sendTransaction({
        to: calldata.to,
        data: calldata.calldata,
        value: 0n,
      });
      setPhase({ kind: "confirming", marketId });
      const receipt = await publicClientFor(chainId).waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("The claim didn't go through — try again.");
      setPhase({ kind: "done", marketId, txHash });
      // Stamp the redemption server-side (P/L bookkeeping + audit).
      // Fire-and-forget: the server verifies the receipt before believing it.
      void api
        .post("/api/markets/redeem/record", { chainId, txHash, marketId })
        .catch(() => undefined);
      window.dispatchEvent(new Event("mantua:refresh-portfolio"));
      onClaimed?.();
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Claim failed" });
    }
  };

  return { phase, claim };
}
