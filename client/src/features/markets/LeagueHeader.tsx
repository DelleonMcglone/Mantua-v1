import { ArrowLeft } from "lucide-react";
import { Freshness } from "./Freshness.tsx";
import { SportChips } from "./SportChips.tsx";
import type { Sport, SportId } from "./sports.ts";
import type { Slate } from "./use-slate.ts";
import { WeekSelector } from "./WeekSelector.tsx";
import type { WeekOption } from "./week-options.ts";

/**
 * The league page's header: back, title and blurb, the freshness stamp, the
 * week selector. On phones the blurb gives way to the sport chips (task
 * 071, MX-001) so switching leagues is one tap without opening the menu.
 */
export function LeagueHeader({
  sport,
  slate,
  weekOptions,
  week,
  onBack,
  onSelectWeek,
  onSelectSport,
}: {
  sport: Sport;
  slate: Slate | undefined;
  weekOptions: WeekOption[];
  week: WeekOption;
  onBack: () => void;
  onSelectWeek: (option: WeekOption) => void;
  onSelectSport: (id: SportId) => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3 md:gap-4">
        <div className="flex min-w-0 items-start gap-2 md:gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to home"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-soft bg-transparent text-text-dim transition-colors hover:text-text cursor-pointer md:mt-1.5 md:h-8 md:w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight md:text-[28px]">{sport.label}</h1>
            <p className="mt-1 hidden text-[13px] text-text-dim md:block">{sport.blurb}</p>
            {slate && <Freshness source={slate} className="mt-1" />}
          </div>
        </div>
        <WeekSelector options={weekOptions} active={week} onSelect={onSelectWeek} />
      </div>
      <SportChips active={sport.id} onSelect={onSelectSport} className="mt-3 md:hidden" />
    </div>
  );
}
