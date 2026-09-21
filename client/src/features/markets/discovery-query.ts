/**
 * T-019 — natural-language discovery and the page title for a filter set.
 * Split from discovery.ts (the filter/sort engine) so each stays small;
 * both produce and consume the same `DiscoverFilters`. Pure.
 */
import type { DiscoverFilters, DiscoverSort, DiscoverStatus, DiscoverWindow } from "./discovery.ts";

const LEAGUES = ["nfl"] as const;

/**
 * Natural-language discovery → filters. Recognises league names, "today" /
 * "this week" / "right now" / "live", "most liquid" / "popular", and a
 * team name after "find"/"show". Returns null when the text carries no
 * discovery cue at all (the caller keeps its other intents).
 */
export function parseDiscoverQuery(text: string): DiscoverFilters | null {
  const t = text.toLowerCase();
  const f: DiscoverFilters = {};
  for (const l of LEAGUES) {
    if (new RegExp(`\\b${l}\\b`).test(t)) {
      f.league = l;
      break;
    }
  }
  if (/\b(most|top)\s+liquid|\bliquidity\b|\bdeepest\b/.test(t)) f.sort = "liquidity";
  else if (/\bpopular\b|\bbusiest\b|\btrending\b/.test(t)) f.sort = "popularity";
  if (/\bright now\b|\blive\b|\bin[- ]play\b/.test(t)) {
    f.startsWithin = "now";
    if (/\blive\b|\bin[- ]play\b/.test(t)) f.status = "live";
  } else if (/\btoday'?s?\b|\btonight\b/.test(t)) f.startsWithin = "today";
  else if (/\bthis week\b|\bweek'?s?\b/.test(t)) f.startsWithin = "week";
  if (/\bwhat can i trade\b|\btradeable\b|\bopen markets?\b/.test(t)) f.status = f.status ?? "open";
  const team =
    /\b(?:find|show(?: me)?)\s+(?:the\s+)?([a-z][a-z .'-]*?)\s+(?:markets?|games?|odds)\b/.exec(t);
  if (team) {
    const candidate = team[1].trim();
    // A team name never contains a league, a time window, or a sort cue.
    const cueWord = new RegExp(
      `\\b(${LEAGUES.join("|")}|today'?s?|tonight|week'?s?|live|liquid|popular|most|top|open)\\b`,
    );
    if (candidate.length > 0 && !cueWord.test(candidate)) f.team = candidate;
  }
  const cue = /\bmarkets?\b|\bwhat can i trade\b|\btrade right now\b|\bgames?\b/.test(t);
  return cue || Object.keys(f).length > 0 ? f : null;
}

const WINDOW_LABEL: Record<DiscoverWindow, string> = {
  now: "tradeable now",
  today: "today",
  week: "this week",
  all: "",
};
const STATUS_LABEL: Record<DiscoverStatus, string> = {
  open: "Open now",
  live: "Live",
  upcoming: "Upcoming",
  final: "Finished",
  all: "",
};
const SORT_LABEL: Record<DiscoverSort, string> = {
  liquidity: "most liquid",
  popularity: "most popular",
  start: "by start time",
  relevance: "",
};

/** Page title for a filter set: "NFL · today", "All markets". */
export function describeDiscoverFilters(f: DiscoverFilters): string {
  const parts: string[] = [];
  if (f.status && STATUS_LABEL[f.status]) parts.push(STATUS_LABEL[f.status]);
  if (f.league) parts.push(f.league.toUpperCase());
  if (f.team) parts.push(f.team);
  if (f.game) parts.push(f.game);
  if (f.startsWithin && WINDOW_LABEL[f.startsWithin]) parts.push(WINDOW_LABEL[f.startsWithin]);
  if (f.sort && SORT_LABEL[f.sort]) parts.push(SORT_LABEL[f.sort]);
  return parts.length > 0 ? parts.join(" · ") : "All markets";
}
