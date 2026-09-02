import type { ComponentType } from "react";
import { SPORTS, type SportId } from "@/features/markets/sports.ts";

/** Where a header nav item sends the user. */
export type NavDestination =
  | { kind: "market"; sport: SportId }
  | { kind: "agent" }
  | { kind: "trading" };

interface NavItem {
  label: string;
  destination: NavDestination;
  icon?: ComponentType<{ className?: string }>;
  /** Renders a hairline divider before this item. */
  divider?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  ...SPORTS.map(
    (s): NavItem => ({
      label: s.label,
      icon: s.icon,
      destination: { kind: "market", sport: s.id },
    }),
  ),
  { label: "Agent", destination: { kind: "agent" }, divider: true },
  { label: "Trading", destination: { kind: "trading" }, divider: true },
];

/**
 * League + section nav. Shared by the landing header and the in-app
 * shell header so both stay in step — a league added to `SPORTS` shows
 * up in both without a second edit.
 *
 * Scrolls sideways rather than wrapping once the row runs out of width.
 * Where a header renders it twice (inline at wide widths, its own strip
 * below at narrow ones), only one is ever displayed: `display: none`
 * keeps the hidden copy out of the accessibility tree, so there is no
 * duplicate landmark.
 */
export function MarketNav({
  onNavigate,
  className,
}: {
  onNavigate: (destination: NavDestination) => void;
  className: string;
}) {
  return (
    <nav
      aria-label="Markets"
      className={`${className} overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      <ul className="flex w-max mx-auto items-center gap-x-3 lg:gap-x-5 text-[13px] font-medium">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex items-center gap-x-3 lg:gap-x-5">
              {item.divider && <span className="h-4 w-px bg-text-mute" aria-hidden="true" />}
              <button
                type="button"
                onClick={() => {
                  onNavigate(item.destination);
                }}
                className="inline-flex items-center gap-1.5 text-text hover:text-accent transition-colors cursor-pointer whitespace-nowrap"
              >
                {Icon && <Icon className="h-[18px] w-[18px]" />}
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
