import { ArrowLeft } from "lucide-react";
import { Freshness } from "./Freshness.tsx";
import type { Sport } from "./sports.ts";
import type { Slate } from "./use-slate.ts";
import { WeekSelector } from "./WeekSelector.tsx";
import type { WeekOption } from "./week-options.ts";

/** The league page's header: back, title and blurb, the freshness stamp, the week selector. */
export function LeagueHeader({
  sport,
  slate,
  weekOptions,
  week,
  onBack,
  onSelectWeek,
}: {
  sport: Sport;
  slate: Slate | undefined;
  weekOptions: WeekOption[];
  week: WeekOption;
  onBack: () => void;
  onSelectWeek: (option: WeekOption) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to home"
          className="mt-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim transition-colors hover:text-text cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">{sport.label}</h1>
          <p className="mt-1 text-[13px] text-text-dim">{sport.blurb}</p>
          {slate && <Freshness source={slate} className="mt-1" />}
        </div>
      </div>
      <WeekSelector options={weekOptions} active={week} onSelect={onSelectWeek} />
    </div>
  );
}
