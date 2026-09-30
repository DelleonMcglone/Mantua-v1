/**
 * R-012 — cross-provider event identity, the pure half.
 *
 * An `events` row is owned by the provider that first described it
 * (`provider`, `providerEventId`). A second provider's slate must refresh
 * that SAME row rather than insert a twin: market ids hash the owning
 * provider's event id (market-id.ts), so a twin would plan a second
 * market for the same game and the board would show the game twice.
 *
 * Two providers describe the same game when they agree on the league, the
 * two team keys (after team-alias.ts) and a kickoff within the tolerance
 * — the same matching rule DM-107's consensus layer uses to corroborate a
 * final. Each provider that has described the row leaves its own id in
 * `providerIds`, so a later poll by that provider (live scores, finals)
 * finds the row by its own id without a team match.
 */

/**
 * How far two providers' kickoff times may disagree and still be one
 * game. Feeds differ by minutes (flex scheduling, time-zone rounding),
 * never by an hour; a doubleheader in the same venue is hours apart.
 */
export const KICKOFF_MATCH_TOLERANCE_MS = 60 * 60 * 1000;

export interface MatchCandidate {
  id: string;
  provider: string;
  providerEventId: string;
  homeTeamKey: string | null;
  awayTeamKey: string | null;
  startsAt: Date;
}

export interface IncomingEvent {
  provider: string;
  providerEventId: string;
  homeTeamKey: string;
  awayTeamKey: string;
  startsAtMs: number;
}

/**
 * The stored row a foreign provider's event describes, or null. Candidates
 * are the league's rows with the same team keys around the kickoff (the
 * caller's query); this picks the closest kickoff within tolerance and
 * never a row the incoming provider already owns (that is the primary
 * identity, matched before this runs).
 */
export function findCanonicalMatch(
  candidates: readonly MatchCandidate[],
  incoming: IncomingEvent,
  toleranceMs: number = KICKOFF_MATCH_TOLERANCE_MS,
): MatchCandidate | null {
  let best: MatchCandidate | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    if (c.provider === incoming.provider) continue;
    if (c.homeTeamKey !== incoming.homeTeamKey || c.awayTeamKey !== incoming.awayTeamKey) continue;
    const gap = Math.abs(c.startsAt.getTime() - incoming.startsAtMs);
    if (gap > toleranceMs || gap >= bestGap) continue;
    best = c;
    bestGap = gap;
  }
  return best;
}

/** `providerIds` with this provider's id recorded; the owner's stays first. */
export function withProviderId(
  existing: Readonly<Record<string, string>> | null | undefined,
  provider: string,
  providerEventId: string,
): Record<string, string> {
  return { ...(existing ?? {}), [provider]: providerEventId };
}

/**
 * The id `provider` knows this row by — its own entry in `providerIds`, or
 * the canonical id when it is the owner. Null when the provider has never
 * described the row (so a poll by that provider must go through the slate).
 */
export function providerIdFor(
  row: { provider: string; providerEventId: string; providerIds: Readonly<Record<string, string>> },
  provider: string,
): string | null {
  if (row.provider === provider) return row.providerEventId;
  return row.providerIds[provider] ?? null;
}
