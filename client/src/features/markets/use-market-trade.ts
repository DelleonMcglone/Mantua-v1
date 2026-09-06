import { useEffect, useState } from "react";
import { parseAbi } from "viem";
import { api } from "@/lib/api.ts";
import { publicClientFor, useChainWalletClient } from "@/lib/privy/wallet-client.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";

const ERC20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface TradeCalldata {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  approvalTarget: `0x${string}` | null;
  inputToken: `0x${string}`;
  marketAddress: `0x${string}`;
  marketId: `0x${string}`;
  yesToken: `0x${string}`;
  /** On-chain price bound encoded in `data` — the server-built calldata
   *  carries the slippage protection; the client just signs it. */
  sqrtPriceLimitX96: string;
  quote: {
    amountIn: string;
    amountOut: string;
    /** Quote − slippage tolerance (display; the calldata's price bound
     *  enforces the same tolerance on-chain). */
    amountOutMinimum: string;
    effectivePriceBps: number | null;
  };
}

export type TradePhase =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "quoted"; calldata: TradeCalldata }
  | { kind: "approving" | "signing" | "confirming"; calldata: TradeCalldata }
  | { kind: "done"; txHash: `0x${string}`; calldata: TradeCalldata }
  | { kind: "error"; message: string };

interface Args {
  eventId: string;
  outcomeIndex: 0 | 1;
  direction: "buy" | "sell";
  /** Human units: USDC for buys, YES tokens for sells. */
  amount: string;
  enabled: boolean;
}

/**
 * Quote + execute one outcome-token trade. The server builds calldata (it
 * holds no keys); the user's wallet signs the approval and the swap. Used
 * by the league page's trade sidebar.
 */
export function useMarketTrade({ eventId, outcomeIndex, direction, amount, enabled }: Args) {
  const getWallet = useChainWalletClient();
  const chainId = BASE_CHAIN_ID;
  const [phase, setPhase] = useState<TradePhase>({ kind: "idle" });

  // Debounced re-quote on any input change.
  useEffect(() => {
    if (!enabled) return;
    const raw = Math.round(Number(amount) * 1e6);
    const timer = setTimeout(() => {
      if (!Number.isFinite(raw) || raw <= 0) {
        setPhase({ kind: "idle" });
        return;
      }
      setPhase({ kind: "quoting" });
      api
        .post<TradeCalldata>("/api/markets/trade/calldata", {
          chainId,
          providerEventId: eventId,
          outcomeIndex,
          direction,
          amountRaw: String(raw),
        })
        .then((calldata) => {
          setPhase({ kind: "quoted", calldata });
        })
        .catch((err: unknown) => {
          setPhase({ kind: "error", message: err instanceof Error ? err.message : "Quote failed" });
        });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [enabled, eventId, outcomeIndex, direction, amount, chainId]);

  const execute = async () => {
    if (phase.kind !== "quoted") return;
    const { calldata } = phase;
    try {
      const wallet = await getWallet();
      if (!wallet) throw new Error("No wallet connected");
      const owner = wallet.account.address;

      if (calldata.approvalTarget) {
        const allowance = await publicClientFor(chainId).readContract({
          address: calldata.inputToken,
          abi: ERC20,
          functionName: "allowance",
          args: [owner, calldata.approvalTarget],
        });
        if (allowance < BigInt(calldata.quote.amountIn)) {
          setPhase({ kind: "approving", calldata });
          // Bounded to the trade amount — never MaxUint (the 031/C-022
          // principle): no standing allowance to the market router
          // survives the trade.
          const approveTx = await wallet.writeContract({
            address: calldata.inputToken,
            abi: ERC20,
            functionName: "approve",
            args: [calldata.approvalTarget, BigInt(calldata.quote.amountIn)],
          });
          await publicClientFor(chainId).waitForTransactionReceipt({ hash: approveTx });
        }
      }

      setPhase({ kind: "signing", calldata });
      const txHash = await wallet.sendTransaction({
        to: calldata.to,
        data: calldata.data,
        value: BigInt(calldata.value),
      });
      setPhase({ kind: "confirming", calldata });
      const receipt = await publicClientFor(chainId).waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      setPhase({ kind: "done", txHash, calldata });
      // Record the fill for entry-price / P&L accounting. Fire-and-forget:
      // the server verifies the receipt before believing it.
      void api
        .post("/api/markets/fills", {
          chainId,
          txHash,
          marketId: calldata.marketId,
          direction,
          tokensRaw: direction === "buy" ? calldata.quote.amountOut : calldata.quote.amountIn,
          usdcRaw: direction === "buy" ? calldata.quote.amountIn : calldata.quote.amountOut,
        })
        .catch(() => undefined);
      window.dispatchEvent(new Event("mantua:refresh-portfolio"));
    } catch (err) {
      setPhase({ kind: "error", message: err instanceof Error ? err.message : "Trade failed" });
    }
  };

  return { phase, execute };
}
