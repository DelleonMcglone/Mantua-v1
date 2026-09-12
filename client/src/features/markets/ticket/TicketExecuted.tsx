import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { TradeCalldata } from "../use-market-trade.ts";

/**
 * T-006 — the explicit "Trade executed" state. The user never wonders
 * whether it went through: what was bought or sold, at what price, what
 * it pays, and the two next moves.
 */
export function TicketExecuted({
  calldata,
  direction,
  teamName,
  onViewPositions,
  onTradeAgain,
}: {
  calldata: TradeCalldata;
  direction: "buy" | "sell";
  teamName: string;
  onViewPositions: () => void;
  onTradeAgain: () => void;
}) {
  const amountIn = Number(calldata.quote.amountIn) / 1e6;
  const amountOut = Number(calldata.quote.amountOut) / 1e6;
  const contracts = direction === "buy" ? amountOut : amountIn;
  const dollars = direction === "buy" ? amountIn : amountOut;
  const price = contracts > 0 ? Math.round((dollars / contracts) * 100) : null;
  return (
    <div
      role="status"
      data-testid="trade-executed"
      className="mt-4 rounded-md border border-green/40 bg-green/10 p-4"
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold text-green">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Trade executed
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-text">
        You {direction === "buy" ? "bought" : "sold"}{" "}
        <span className="font-mono">{contracts.toFixed(2)}</span> {teamName} contracts for{" "}
        <span className="font-mono">${dollars.toFixed(2)}</span>
        {price !== null && ` at ${String(price)}¢ each`}.
      </p>
      {direction === "buy" && (
        <p className="mt-1 text-[12px] text-text-dim">
          Pays <span className="font-mono text-text">${contracts.toFixed(2)}</span> if the{" "}
          {teamName} win. Sell any time before the game goes final.
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" size="sm" className="flex-1" onClick={onViewPositions}>
          View position
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 border-border-soft"
          onClick={onTradeAgain}
        >
          Trade again
        </Button>
      </div>
    </div>
  );
}
