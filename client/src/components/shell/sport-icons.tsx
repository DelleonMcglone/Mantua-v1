/**
 * Sport glyphs for the league nav and the per-sport market pages.
 * Generic marks (ball / puck shapes) rather than league wordmarks —
 * the leagues' own logos are trademarked and can't ship in the bundle.
 * Drawn in the lucide idiom (24×24, currentColor stroke, width 2) so
 * they sit cleanly next to the lucide icons used elsewhere.
 */

interface IconProps {
  className?: string;
}

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

/** Basketball — circle with the two crossing seams. */
export function BasketballIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18" />
      <path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8" />
    </svg>
  );
}

/** American football — pointed ellipse with laces. */
export function FootballIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.2 19.8c-1.4-4.6-.5-10.2 3-13.6 3.4-3.5 9-4.4 13.6-3 1.4 4.6.5 10.2-3 13.6-3.4 3.5-9 4.4-13.6 3Z" />
      <path d="M9 15l6-6M10.5 12.5l1 1M12.5 10.5l1 1" />
    </svg>
  );
}

/** Baseball — circle with the paired curved seams. */
export function BaseballIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M6.3 5.2C8.4 7 9.7 9.4 9.7 12s-1.3 5-3.4 6.8M17.7 5.2C15.6 7 14.3 9.4 14.3 12s1.3 5 3.4 6.8" />
    </svg>
  );
}

/** Hockey — crossed sticks over the puck. */
export function HockeyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3.5 14.6 15.8h4.9" />
      <path d="M18 3.5 9.4 15.8H4.5" />
      <circle cx="12" cy="19.8" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Soccer ball — circle with the centre pentagon and its spokes. */
export function SoccerIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2 15.7 9.9 14.3 14.3H9.7L8.3 9.9 12 7.2Z" />
      <path d="M12 7.2V3M15.7 9.9l3.9-1.3M14.3 14.3l2.5 3.3M9.7 14.3l-2.5 3.3M8.3 9.9 4.4 8.6" />
    </svg>
  );
}
