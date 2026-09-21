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

/** Boxing — a pair of gloves, the requested mark (no league logo on the CDN). */
export function BoxingGlovesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      {/* left glove */}
      <path d="M3.2 6.2A3 3 0 0 1 6.2 3.2h2.3a3.5 3.5 0 0 1 3.4 2.7l.6 2.8a3.6 3.6 0 0 1-1.1 3.5l-.3.3v2.1H5.6a2.4 2.4 0 0 1-2.4-2.4V6.2Zm1.6 0v6a.8.8 0 0 0 .8.8h4V11a2 2 0 0 0 .5-1.4l-.5-2.4a1.9 1.9 0 0 0-1.9-1.6H6.2a1.4 1.4 0 0 0-1.4 1.4Z" />
      <path d="M5.4 15.3h5.7v2.3a1.2 1.2 0 0 1-1.2 1.2H6.6a1.2 1.2 0 0 1-1.2-1.2v-2.3Z" />
      {/* right glove */}
      <path d="M20.8 8.6a3 3 0 0 0-3-3h-2.3a3.5 3.5 0 0 0-3.4 2.7l-.6 2.8a3.6 3.6 0 0 0 1.1 3.5l.3.3v2.1h5.5a2.4 2.4 0 0 0 2.4-2.4V8.6Zm-1.6 0v6a.8.8 0 0 1-.8.8h-4v-2a2 2 0 0 1-.5-1.4l.5-2.4a1.9 1.9 0 0 1 1.9-1.6h1.5a1.4 1.4 0 0 1 1.4 1.4Z" />
      <path d="M12.9 17.7h5.7V20a1.2 1.2 0 0 1-1.2 1.2h-3.3a1.2 1.2 0 0 1-1.2-1.2v-2.3Z" />
    </svg>
  );
}

/** Karate Combat — a "KC" roundel: the promotion has no mark on the CDN. */
export function KarateCombatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <text
        x="12"
        y="15.6"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="800"
        fontFamily="Inter, system-ui, sans-serif"
        fill="currentColor"
      >
        KC
      </text>
    </svg>
  );
}
