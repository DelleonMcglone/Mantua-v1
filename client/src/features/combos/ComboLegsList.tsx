import { X } from "lucide-react";
import { oddsLabel, pctLabel, type BuilderLeg, type ComboLegWire } from "./combo-core.ts";

/**
 * Task 072 / CB-002 — the legs of the ticket being built, each with its
 * live price and implied odds from the quote, and a remove control. The
 * builder owns the list; league pages add to it with `+ Combo`.
 */
export function ComboLegsList({
  legs,
  quoted,
  onRemove,
}: {
  legs: readonly BuilderLeg[];
  quoted: readonly ComboLegWire[];
  onRemove: (leg: BuilderLeg) => void;
}) {
  if (legs.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-border-soft px-4 py-5 text-center text-[12.5px] leading-relaxed text-text-dim">
        No legs yet. Open a league and tap <span className="font-medium text-text">+ Combo</span> on
        any team to add it here. Two legs make a combo; every leg must win for it to pay.
      </p>
    );
  }
  return (
    <ul data-testid="combo-legs" className="mt-3 flex flex-col gap-1.5">
      {legs.map((leg, i) => {
        const q = quoted.find(
          (w) => w.providerEventId === leg.providerEventId && w.outcomeIndex === leg.outcomeIndex,
        );
        return (
          <li
            key={`${leg.providerEventId}-${String(leg.outcomeIndex)}`}
            className="flex items-center gap-2 rounded-sm border border-border-soft px-2.5 py-2 text-[12.5px]"
          >
            <span className="w-5 font-mono text-[10px] text-text-mute">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{leg.teamName}</span>
              <span className="text-text-dim"> to beat {leg.opponentName}</span>
              {q?.result && q.result !== "pending" && (
                <span className="ml-1 text-[10px] uppercase tracking-wider text-text-mute">
                  {q.result}
                </span>
              )}
            </span>
            <span className="font-mono text-[11px] text-text-dim">
              {pctLabel(q?.priceBps ?? null)} · {oddsLabel(q?.priceBps ?? null)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${leg.teamName} from the combo`}
              onClick={() => {
                onRemove(leg);
              }}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-text-mute hover:text-text cursor-pointer md:h-6 md:w-6"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
