import type { ComponentType } from "react";
import {
  BasketballIcon,
  BaseballIcon,
  BoxingGlovesIcon,
  FootballIcon,
  HockeyIcon,
  KarateCombatIcon,
} from "@/components/shell/sport-icons.tsx";

/**
 * The sports Mantua lists. One catalog feeds the header's league bar, the
 * sport chips, the board and the per-sport market pages, so a sport added
 * here shows up everywhere with the same label and mark.
 *
 * NFL is the only covered league (owner decision, 2026-09-20). The others
 * are listed and selectable, and open a "coming soon" page — never a live
 * market. Promoting one is flipping its `coverage` to `launch`, plus the
 * server's covered-league lists.
 */
export type SportId =
  | "nfl"
  | "nba"
  | "wnba"
  | "mlb"
  | "nhl"
  | "ncaaf"
  | "ncaab"
  | "ufc"
  | "boxing"
  | "karate"
  | "nascar"
  | "golf";

export interface Sport {
  id: SportId;
  /** Nav label and page title. */
  label: string;
  /** One-line description of what trades on this sport's markets. */
  blurb: string;
  /** The real league logo (ESPN CDN, the same host the team logos come
   *  from), when one exists; otherwise the sport's glyph (`icon`) is the
   *  mark. `icon` is also the fallback if the image fails to load. */
  logo?: string;
  /** Variant for the dark theme, for marks that are mostly black and would
   *  otherwise disappear against it (the NASCAR wordmark, the Karate Combat
   *  square). Omitted when `logo` reads on both surfaces. */
  logoDark?: string;
  icon: ComponentType<{ className?: string }>;
  /** `launch` leagues are the covered set — their slates are ingested and
   *  their markets open. `soon` sports are listed, selectable, and land on
   *  the coming-soon page. */
  coverage: "launch" | "soon";
}

const LEAGUE_LOGOS = "https://a.espncdn.com/i/teamlogos/leagues/500";
const SPORT_LOGOS = "https://a.espncdn.com/i/espn/misc_logos/500";
/** Marks the owner supplied (client/public/assets/leagues). */
const OWN_LOGOS = "/assets/leagues";

export const SPORTS: Sport[] = [
  {
    id: "nfl",
    label: "NFL",
    blurb: "Moneylines on every NFL game.",
    logo: `${LEAGUE_LOGOS}/nfl.png`,
    icon: FootballIcon,
    coverage: "launch",
  },
  {
    id: "nba",
    label: "NBA",
    blurb: "Coming soon.",
    logo: `${LEAGUE_LOGOS}/nba.png`,
    icon: BasketballIcon,
    coverage: "soon",
  },
  {
    id: "wnba",
    label: "WNBA",
    blurb: "Coming soon.",
    logo: `${LEAGUE_LOGOS}/wnba.png`,
    icon: BasketballIcon,
    coverage: "soon",
  },
  {
    id: "mlb",
    label: "MLB",
    blurb: "Coming soon.",
    logo: `${LEAGUE_LOGOS}/mlb.png`,
    icon: BaseballIcon,
    coverage: "soon",
  },
  {
    id: "nhl",
    label: "NHL",
    blurb: "Coming soon.",
    logo: `${LEAGUE_LOGOS}/nhl.png`,
    icon: HockeyIcon,
    coverage: "soon",
  },
  // College: the owner supplied a football and a basketball as the marks.
  {
    id: "ncaaf",
    label: "NCAAF",
    blurb: "Coming soon.",
    logo: `${OWN_LOGOS}/ncaaf.png`,
    icon: FootballIcon,
    coverage: "soon",
  },
  {
    id: "ncaab",
    label: "NCAAB",
    blurb: "Coming soon.",
    logo: `${OWN_LOGOS}/ncaab.png`,
    icon: BasketballIcon,
    coverage: "soon",
  },
  {
    id: "ufc",
    label: "UFC",
    blurb: "Coming soon.",
    logo: `${LEAGUE_LOGOS}/ufc.png`,
    icon: BoxingGlovesIcon,
    coverage: "soon",
  },
  {
    id: "boxing",
    label: "Boxing",
    blurb: "Coming soon.",
    logo: `${OWN_LOGOS}/boxing-glove.png`,
    icon: BoxingGlovesIcon,
    coverage: "soon",
  },
  {
    id: "karate",
    label: "Karate Combat",
    blurb: "Coming soon.",
    logo: `${OWN_LOGOS}/karate-combat.png`,
    logoDark: `${OWN_LOGOS}/karate-combat-dark.png`,
    icon: KarateCombatIcon,
    coverage: "soon",
  },
  {
    id: "nascar",
    label: "NASCAR",
    blurb: "Coming soon.",
    logo: `${OWN_LOGOS}/nascar.png`,
    logoDark: `${OWN_LOGOS}/nascar-dark.png`,
    icon: HockeyIcon,
    coverage: "soon",
  },
  {
    id: "golf",
    label: "Golf",
    blurb: "Coming soon.",
    logo: `${SPORT_LOGOS}/golf.png`,
    icon: BaseballIcon,
    coverage: "soon",
  },
];

export function getSport(id: SportId): Sport {
  // The union keeps the fallback unreachable; prefer it to throwing so a
  // stale persisted route can't blank the app.
  return SPORTS.find((s) => s.id === id) ?? SPORTS[0];
}

export function isSportId(value: unknown): value is SportId {
  return typeof value === "string" && SPORTS.some((s) => s.id === value);
}
