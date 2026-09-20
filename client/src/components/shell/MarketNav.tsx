import { SPORTS, type SportId } from "@/features/markets/sports.ts";
import { LeagueLogo } from "./LeagueLogo.tsx";

/** Where a header nav item sends the user. */
export type NavDestination =
  | { kind: "market"; sport: SportId }
  | { kind: "agent" }
  /** Task 072 — the Combo Builder. */
  | { kind: "combos" };

interface NavItem {
  label: string;
  destination: NavDestination;
  /** Listed but not yet tradable (`coverage: "soon"`). Selectable — it
   *  opens the coming-soon page — but dimmed and labelled, never rendered
   *  as a live market. */
  comingSoon?: boolean;
  /** The league entry the item stands for (league items only). */
  sport?: (typeof SPORTS)[number];
}

// The league bar is DATA-DRIVEN off `SPORTS` (DM-105): flipping a sport to
// `launch` in sports.ts lights it up here with no nav edit.
const LEAGUE_ITEMS: NavItem[] = SPORTS.map(
  (s): NavItem => ({
    label: s.label,
    sport: s,
    destination: { kind: "market", sport: s.id },
    ...(s.coverage === "soon" ? { comingSoon: true } : {}),
  }),
);

/**
 * The leagues as a single column, for the hamburger sheet (B-014 mobile
 * guidance). On wide screens the same list is the `LeagueBar` sub-header.
 * Combos and the agent are not header items: the home cards open them.
 */
export function MarketNav({
  onNavigate,
  className,
}: {
  onNavigate: (destination: NavDestination) => void;
  className: string;
}) {
  return (
    <nav aria-label="Markets" className={className}>
      <ul className="flex flex-col text-[14px] font-medium">
        {LEAGUE_ITEMS.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              onClick={() => {
                onNavigate(item.destination);
              }}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-2.5 text-left transition-colors cursor-pointer hover:bg-row-hover hover:text-accent ${item.comingSoon ? "text-text-dim" : "text-text"}`}
            >
              {item.sport && <LeagueLogo league={item.sport} />}
              {item.label}
              {item.comingSoon && item.sport && (
                <span className="ml-auto text-[11px] text-text-mute">Coming soon</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The league sub-header: every league with its logo, NFL live and the rest
 * selectable but marked coming soon. Centred when there is room; scrolls sideways rather than wrapping when the row runs out of
 * width. `active` underlines the league page currently open.
 */
export function LeagueBar({
  onNavigate,
  active = null,
  className = "",
}: {
  onNavigate: (destination: NavDestination) => void;
  active?: SportId | null;
  className?: string;
}) {
  return (
    <nav
      aria-label="Leagues"
      className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      <ul className="mx-auto flex w-max items-center gap-x-1 text-[13px] font-medium">
        {LEAGUE_ITEMS.map((item) => {
          const isActive = item.sport !== undefined && item.sport.id === active;
          return (
            <li key={item.label}>
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                {...(item.comingSoon ? { title: `${item.label} — coming soon` } : {})}
                onClick={() => {
                  onNavigate(item.destination);
                }}
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors cursor-pointer whitespace-nowrap hover:bg-row-hover hover:text-accent ${
                  isActive
                    ? "bg-accent/10 text-text"
                    : item.comingSoon
                      ? "text-text-dim"
                      : "text-text"
                }`}
              >
                {item.sport && <LeagueLogo league={item.sport} className="h-5 w-5" />}
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
