/**
 * T-017 — resolve a team hint ("chiefs", "kc") from a position command to
 * the game and side in the loaded slate, so "bet on the Chiefs" lands with
 * the Chiefs already selected. Pure: no React, no `@/` imports.
 */

interface TeamLike {
  name: string;
  abbreviation: string;
  key?: string;
}

interface EventLike {
  providerEventId: string;
  home: TeamLike;
  away: TeamLike;
}

export interface TeamSelection {
  eventId: string;
  /** 0 = home, 1 = away. */
  outcomeIndex: 0 | 1;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(team: TeamLike, hint: string): boolean {
  const hay = `${norm(team.name)} ${norm(team.abbreviation)} ${norm(team.key?.split(":").at(-1) ?? "")}`;
  return hint.split(" ").every((w) => hay.includes(w));
}

/** First event whose home or away team matches the hint; null when none. */
export function resolveTeamSelection(
  events: readonly EventLike[],
  hint: string,
): TeamSelection | null {
  const h = norm(hint);
  if (h.length === 0) return null;
  for (const e of events) {
    if (matches(e.home, h)) return { eventId: e.providerEventId, outcomeIndex: 0 };
    if (matches(e.away, h)) return { eventId: e.providerEventId, outcomeIndex: 1 };
  }
  return null;
}
