import { formatProbability } from "../probability-source.ts";
import type { Side } from "../trade-ticket-core.ts";
import type { SlateEvent } from "../use-slate.ts";

/**
 * Buy / Sell tabs and the two side buttons. Picking a side is tap one of
 * the budget; both directions are first-class before and during the game
 * (T-003, D-103).
 */
export function TicketSides({
  event,
  side,
  direction,
  onPick,
  onDirection,
}: {
  event: SlateEvent;
  side: Side;
  direction: "buy" | "sell";
  onPick: (side: Side) => void;
  onDirection: (d: "buy" | "sell") => void;
}) {
  const sides = [
    { idx: 0 as const, team: event.home },
    { idx: 1 as const, team: event.away },
  ];
  return (
    <>
      <div className="mt-3 flex gap-4 border-b border-border-soft text-[13px]">
        {(["buy", "sell"] as const).map((d) => (
          <button
            key={d}
            type="button"
            data-direction={d}
            onClick={() => {
              onDirection(d);
            }}
            className={`pb-2 capitalize cursor-pointer ${
              direction === d
                ? "border-b-2 border-text font-semibold text-text"
                : "text-text-dim hover:text-text"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {sides.map(({ idx, team }) => (
          <button
            key={idx}
            type="button"
            data-side={idx}
            aria-pressed={side === idx}
            onClick={() => {
              onPick(idx);
            }}
            className={`rounded-md px-3 py-2.5 text-center font-mono text-[13px] font-semibold transition-colors cursor-pointer ${
              side === idx ? "bg-accent text-white" : "bg-chip text-text hover:bg-accent/25"
            }`}
          >
            {team.abbreviation} {formatProbability(event.homeWinProbabilityBps, idx).cents}
          </button>
        ))}
      </div>
    </>
  );
}
