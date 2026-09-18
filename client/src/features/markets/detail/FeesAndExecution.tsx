import { FeeExplainer } from "../FeeExplainer.tsx";

/**
 * Phase 11 (D-004) — the Fees & execution section of the deeper layer:
 * the fee model (the same explainer the ticket links to, open) and the
 * exact mechanics of a fill, for users who want to know what happens
 * between Confirm and "Trade executed".
 */
const STEPS: readonly string[] = [
  "You tap a price and an amount. The exact fee and what you receive are quoted before you confirm — the number on the ticket is the number you pay.",
  "Confirm signs one trade from your balance. The app sponsors the cost of sending it, so the fee on the ticket is the whole cost of the trade.",
  "The trade fills at the quoted price or better, protected by a slippage limit. If the price has moved past that limit, nothing is charged and you can re-quote.",
  "A fill is verified before it shows as executed. Your position then appears in Portfolio and stays tradeable until the game goes final.",
  "Winning contracts pay $1 each after the review window. Postponed, cancelled, or tied games settle both sides at 50¢.",
];

export function FeesAndExecution() {
  return (
    <section data-testid="fees-execution" className="flex flex-col gap-4">
      <div>
        <h4 className="text-[12.5px] font-semibold text-text">The fee</h4>
        <div className="mt-1">
          <FeeExplainer defaultOpen />
        </div>
      </div>
      <div>
        <h4 className="text-[12.5px] font-semibold text-text">How a trade is filled</h4>
        <ol className="mt-1 flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-text-dim">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-2">
              <span className="w-4 shrink-0 font-mono text-text-mute">{String(i + 1)}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
