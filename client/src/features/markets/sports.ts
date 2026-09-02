import type { ComponentType } from "react";
import {
  BasketballIcon,
  FootballIcon,
  BaseballIcon,
  HockeyIcon,
  SoccerIcon,
} from "@/components/shell/sport-icons.tsx";

/**
 * The leagues Mantua runs prediction markets for. One catalog feeds both
 * the landing header nav and the per-sport market pages, so a league
 * added here shows up in both places with the same label and glyph.
 */
export type SportId = "nba" | "wnba" | "nfl" | "mlb" | "nhl" | "soccer";

export interface Sport {
  id: SportId;
  /** Nav label and page title. */
  label: string;
  /** One-line description of what trades on this league's markets. */
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  /** `launch` leagues are the covered set — their slates are ingested and
   *  their markets open as the Dynamic Market Hook lands. `soon` leagues
   *  are in the nav but not yet in coverage. Per DM-105. */
  coverage: "launch" | "soon";
}

export const SPORTS: Sport[] = [
  {
    id: "nfl",
    label: "NFL",
    blurb: "Moneylines on every NFL game.",
    icon: FootballIcon,
    coverage: "launch",
  },
  {
    id: "wnba",
    label: "WNBA",
    blurb: "Moneylines on every WNBA game.",
    icon: BasketballIcon,
    coverage: "launch",
  },
  {
    id: "nba",
    label: "NBA",
    blurb: "Moneylines, spreads, and totals on every NBA game.",
    icon: BasketballIcon,
    coverage: "soon",
  },
  {
    id: "mlb",
    label: "MLB",
    blurb: "Moneylines, run lines, and totals on every MLB game.",
    icon: BaseballIcon,
    coverage: "soon",
  },
  {
    id: "nhl",
    label: "NHL",
    blurb: "Moneylines, puck lines, and totals on every NHL game.",
    icon: HockeyIcon,
    coverage: "soon",
  },
  {
    id: "soccer",
    label: "Soccer",
    blurb: "Match result, both-teams-to-score, and totals across major leagues.",
    icon: SoccerIcon,
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
