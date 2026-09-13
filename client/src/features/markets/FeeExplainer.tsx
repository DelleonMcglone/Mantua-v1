import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * T-009 — the fee-structure explainer, one tap away from any fee line.
 * The numbers are the ones the hook enforces (`RiskPolicy.sol`); the
 * long-form page is `docs/fee-model.md`.
 */
const POINTS: readonly string[] = [
  "Regular season: 0% trading fee on every trade.",
  "Playoffs: a dynamic fee between 0.10% and 0.70% of what you trade.",
  "0.70% is the absolute ceiling. Nothing can raise it.",
  "Inside the band the fee responds to liquidity, volatility, trading activity, and how uncertain the market is.",
  "Fees are highest on coin-flip contracts near 50¢ and fall toward zero near 1¢ and 99¢.",
  "The fee you see on the ticket is the exact fee your trade pays.",
];

export function FeeExplainer({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="text-[11.5px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 text-text-dim hover:text-text cursor-pointer"
      >
        How fees work
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul data-testid="fee-explainer" className="mt-2 flex flex-col gap-1.5 text-text-dim">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-2 leading-relaxed">
              <span
                aria-hidden="true"
                className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-mute"
              />
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
