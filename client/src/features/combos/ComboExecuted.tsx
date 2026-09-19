import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { TradeCalldata } from "@/features/markets/use-market-trade.ts";

/**
 * Task 072 — the explicit "Combo placed" card (the T-006 standard): what
 * was staked, how many shares, what they pay, and the next moves.
 */
export function ComboExecuted({
  calldata,
  recorded,
  onReset,
}: {
  calldata: TradeCalldata;
  /** False while the ticket is still being written to your history (R-004). */
  recorded: boolean;
  onReset: () => void;
}) {
  const stake = Number(calldata.quote.amountIn) / 1e6;
  const shares = Number(calldata.quote.amountOut) / 1e6;
  return (
    <div
      role="status"
      data-testid="combo-executed"
      className="mt-4 rounded-md border border-green/40 bg-green/10 p-4"
    >
      <div className="flex items-center gap-2 text-[15px] font-semibold text-green">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Combo placed
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-text">
        Staked <span className="font-mono">${stake.toFixed(2)}</span> for{" "}
        <span className="font-mono">{shares.toFixed(2)}</span> shares — pays{" "}
        <span className="font-mono">${shares.toFixed(2)}</span> if every leg wins.
      </p>
      <p className="mt-1 text-[11px] text-text-dim">
        {recorded
          ? "It shows under Combos on your profile, marked at the live price."
          : "Recording it to your history — it will appear on your profile shortly."}
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("mantua:open-profile"));
          }}
        >
          View combos
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Build another
        </Button>
      </div>
    </div>
  );
}
