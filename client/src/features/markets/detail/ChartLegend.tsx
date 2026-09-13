import { ProbabilityTag } from "../ProbabilityTag.tsx";
import type { SlateEvent } from "../use-slate.ts";

/** The price chart's legend: each side's colour, abbreviation, and latest price. */
export function ChartLegend({
  event,
  homePct,
  awayPct,
}: {
  event: SlateEvent;
  homePct: number | undefined;
  awayPct: number | undefined;
}) {
  return (
    <div className="mb-2 flex items-center gap-4 text-[12px]">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-accent" />
        {event.home.abbreviation}
        {typeof homePct === "number" && (
          <span className="font-mono font-semibold text-text">{(homePct / 100).toFixed(0)}%</span>
        )}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-green" />
        {event.away.abbreviation}
        {typeof awayPct === "number" && (
          <span className="font-mono font-semibold text-text">{(awayPct / 100).toFixed(0)}%</span>
        )}
      </span>
      <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-text-mute">
        implied win probability <ProbabilityTag liveOdds={event.liveOdds} />
      </span>
    </div>
  );
}
