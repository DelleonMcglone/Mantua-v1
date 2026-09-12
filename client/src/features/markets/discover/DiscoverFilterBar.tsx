import { SPORTS } from "../sports.ts";
import { Chip } from "./FilterChip.tsx";
import type {
  DiscoverFilters,
  DiscoverSort,
  DiscoverStatus,
  DiscoverWindow,
} from "../discovery.ts";

const STATUS: { v: DiscoverStatus; label: string }[] = [
  { v: "open", label: "Open" },
  { v: "live", label: "Live" },
  { v: "upcoming", label: "Upcoming" },
  { v: "all", label: "All" },
];
const WINDOW: { v: DiscoverWindow; label: string }[] = [
  { v: "now", label: "Now" },
  { v: "today", label: "Today" },
  { v: "week", label: "This week" },
  { v: "all", label: "Any time" },
];
const SORT: { v: DiscoverSort; label: string }[] = [
  { v: "relevance", label: "Relevance" },
  { v: "liquidity", label: "Liquidity" },
  { v: "popularity", label: "Popularity" },
  { v: "start", label: "Start time" },
];

/**
 * T-018 — sport/league, status, start time, sort, and a team/game search.
 * Every chip edits the same `DiscoverFilters` the natural-language path
 * produces, so the page title and the results agree with what was typed.
 */
export function DiscoverFilterBar({
  filters,
  onChange,
}: {
  filters: DiscoverFilters;
  onChange: (next: DiscoverFilters) => void;
}) {
  // `undefined` in a patch removes the key, so a cleared filter is absent
  // (and the page title reads "All markets"), not present-but-empty.
  const set = (patch: { [K in keyof DiscoverFilters]?: DiscoverFilters[K] | undefined }) => {
    const merged: Record<string, unknown> = { ...filters, ...patch };
    const next = Object.fromEntries(
      Object.entries(merged).filter(([, value]) => value !== undefined),
    ) as DiscoverFilters;
    onChange(next);
  };
  const launch = SPORTS.filter((s) => s.coverage === "launch");
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          value=""
          active={!filters.league}
          label="All leagues"
          onPick={() => {
            set({ league: undefined });
          }}
        />
        {launch.map((s) => (
          <Chip
            key={s.id}
            value={s.id}
            active={filters.league === s.id}
            label={s.label}
            onPick={(v) => {
              set({ league: v });
            }}
          />
        ))}
        <input
          aria-label="Search a team or game"
          value={filters.team ?? filters.game ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            set({ team: v.trim() === "" ? undefined : v, game: undefined });
          }}
          placeholder="Team or game…"
          className="ml-auto w-44 rounded-full border border-border-soft bg-bg-elev px-3 py-1 text-[12px] text-text outline-none focus:border-accent"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS.map((o) => (
          <Chip
            key={o.v}
            value={o.v}
            active={(filters.status ?? "all") === o.v}
            label={o.label}
            onPick={(v) => {
              set({ status: v });
            }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border-soft" aria-hidden="true" />
        {WINDOW.map((o) => (
          <Chip
            key={o.v}
            value={o.v}
            active={(filters.startsWithin ?? "all") === o.v}
            label={o.label}
            onPick={(v) => {
              set({ startsWithin: v });
            }}
          />
        ))}
        <span className="mx-1 h-4 w-px bg-border-soft" aria-hidden="true" />
        {SORT.map((o) => (
          <Chip
            key={o.v}
            value={o.v}
            active={(filters.sort ?? "relevance") === o.v}
            label={o.label}
            onPick={(v) => {
              set({ sort: v });
            }}
          />
        ))}
      </div>
    </div>
  );
}
