import { useState } from "react";
import { api } from "@/lib/api.ts";
import { useChainWalletClient } from "@/lib/privy/wallet-client.ts";
import { BASE_CHAIN_ID } from "@/lib/chains.ts";
import { usePendingTrades } from "@/features/markets/PendingTradesProvider.tsx";
import { classifyTradeError } from "@/features/markets/trade-status-core.ts";
import type { TradeCalldata, TradePhase, TradeQuote } from "@/features/markets/use-market-trade.ts";
import {
  approveIfNeeded,
  awaitTradeReceipt,
  sendTrade,
} from "@/features/markets/wallet-execution.ts";
import { legRefs, type BuilderLeg, type ComboQuoteOk } from "./combo-core.ts";

/**
 * Task 072 / CB-005 — the combo's single transaction from the wallet's
 * side: prepare the conjunction market (idempotent, operator-created),
 * fetch the one calldata (cap-checked once for the whole stake), approve
 * if short, sign, wait, report the fill. The phases are the trade
 * ticket's own, so the status and executed cards render unchanged.
 */

interface ComboCalldata extends TradeCalldata {
  marketId: `0x${string}`;
}

/** The ticket-shaped quote the `building` phase carries (addresses arrive with the calldata). */
function buildingQuote(quote: ComboQuoteOk): TradeQuote {
  return {
    marketId: quote.marketId as `0x${string}`,
    marketAddress: "0x",
    yesToken: "0x",
    quote: {
      amountIn: quote.stakeRaw,
      amountOut: quote.sharesRaw,
      amountOutMinimum: quote.sharesRaw,
      effectivePriceBps: quote.effectivePriceBps,
    },
    fee: quote.fee,
  };
}

export function useComboTrade(legs: readonly BuilderLeg[]) {
  const getWallet = useChainWalletClient();
  const chainId = BASE_CHAIN_ID;
  const register = usePendingTrades();
  const [phase, setPhase] = useState<TradePhase>({ kind: "idle" });

  const reset = () => {
    setPhase({ kind: "idle" });
  };

  const execute = async (quote: ComboQuoteOk) => {
    const refs = legRefs(legs);
    try {
      const wallet = await getWallet();
      if (!wallet) throw new Error("No wallet connected");
      const owner = wallet.account.address;
      setPhase({ kind: "building", quote: buildingQuote(quote) });
      if (!quote.exists) {
        await api.post("/api/combos/prepare", { chainId, legs: refs });
      }
      const calldata = await api.post<ComboCalldata>("/api/combos/calldata", {
        chainId,
        marketId: quote.marketId,
        legs: refs,
        direction: "buy",
        amountRaw: quote.stakeRaw,
      });
      await approveIfNeeded(wallet, calldata, chainId, () => {
        setPhase({ kind: "approving", calldata });
      });
      setPhase({ kind: "signing", calldata });
      const txHash = await sendTrade(wallet, calldata);
      register.add({
        txHash,
        chainId,
        wallet: owner,
        marketId: calldata.marketId,
        providerEventId: "combo",
        direction: "buy",
        tokensRaw: calldata.quote.amountOut,
        usdcRaw: calldata.quote.amountIn,
        submittedAt: Date.now(),
        combo: { legs: refs },
      });
      setPhase({ kind: "confirming", txHash, calldata });
      const receipt = await awaitTradeReceipt(chainId, txHash);
      if (receipt === "late") {
        setPhase({ kind: "pending", txHash, calldata });
        return;
      }
      if (receipt !== "success") {
        register.remove(txHash);
        setPhase({ kind: "failed", txHash, calldata });
        return;
      }
      let recorded = false;
      try {
        await api.post("/api/combos/fills", {
          chainId,
          txHash,
          marketId: calldata.marketId,
          legs: refs,
          direction: "buy",
          tokensRaw: calldata.quote.amountOut,
          usdcRaw: calldata.quote.amountIn,
        });
        recorded = true;
        register.remove(txHash);
      } catch {
        recorded = false;
      }
      setPhase({ kind: "done", txHash, calldata, recorded });
      window.dispatchEvent(new Event("mantua:refresh-portfolio"));
    } catch (err) {
      const e = classifyTradeError(err, "Combo failed");
      setPhase({ kind: "error", message: e.message, errorKind: e.kind, error: err });
    }
  };

  return { phase, execute, reset };
}
