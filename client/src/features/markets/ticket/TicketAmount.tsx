import { rawToHuman6 } from "../market-trade-core.ts";
import { AMOUNT_PRESETS, type TicketTap } from "../trade-ticket-core.ts";

/**
 * The amount row. Presets SET the amount in one tap (tap two of the
 * budget); typing is the escape hatch. Sells show the held contracts and a
 * Max that sells exactly that balance.
 */
export function TicketAmount({
  amount,
  direction,
  contractBalance,
  onTap,
}: {
  amount: string;
  direction: "buy" | "sell";
  contractBalance: bigint | null;
  onTap: (tap: TicketTap) => void;
}) {
  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[14px] font-medium">
          {direction === "buy" ? "Amount" : "Contracts"}
        </span>
        <div className="flex items-baseline gap-1">
          {direction === "buy" && <span className="text-[18px] text-text-mute">$</span>}
          <input
            aria-label={direction === "buy" ? "Amount in dollars" : "Contracts to sell"}
            value={amount}
            onChange={(e) => {
              onTap({ kind: "type", amount: e.target.value });
            }}
            inputMode="decimal"
            className="w-28 bg-transparent text-right font-mono text-[26px] font-semibold text-text outline-none"
          />
        </div>
      </div>
      {direction === "sell" && contractBalance !== null && (
        <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-text-dim">
          You hold{" "}
          <span className="font-mono text-text">{(Number(contractBalance) / 1e6).toFixed(2)}</span>{" "}
          contracts
          <button
            type="button"
            aria-label="Sell your full balance"
            onClick={() => {
              onTap({ kind: "type", amount: rawToHuman6(contractBalance) });
            }}
            className="rounded-sm border border-border-soft px-1.5 py-0.5 text-[10px] text-text-dim hover:text-text cursor-pointer"
          >
            Max
          </button>
        </div>
      )}
      {direction === "buy" && (
        <div className="mt-2 flex justify-end gap-1.5">
          {AMOUNT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              data-preset={n}
              aria-pressed={amount === String(n)}
              onClick={() => {
                onTap({ kind: "preset", amount: n });
              }}
              className={`rounded-sm border px-2 py-1 text-[11px] cursor-pointer ${
                amount === String(n)
                  ? "border-accent text-text"
                  : "border-border-soft text-text-dim hover:text-text"
              }`}
            >
              ${n}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
