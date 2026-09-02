/**
 * B3-007 / B3-008 — a second provider behind the same interface, and
 * disagreement detection between the two.
 *
 * DM-107 makes ESPN primary and adds a second source specifically so that a
 * final can be *corroborated* rather than trusted. The value is not redundancy
 * for uptime — the resilience layer already handles that — it is that a single
 * undocumented endpoint reporting a wrong score would otherwise settle a market
 * with nothing to contradict it.
 *
 * The rule this file enforces: **agreement resolves, disagreement escalates.**
 * Two providers that agree on a final are strong evidence. Two that disagree
 * are not weak evidence for the majority — they are evidence that something is
 * wrong, and spec §3.5 wants a human, not a tiebreak.
 */

import { logger } from "../logger.ts";
import {
  type LeagueSlug,
  type ProviderEvent,
  type ProviderSlate,
  type SportsDataProvider,
  ProviderShapeError,
  teamKey,
} from "./provider.ts";
import { LIVE_TTL_MS, PREGAME_TTL_MS, ResilientJson } from "./resilience.ts";

/**
 * Adapter for a second scores source, shaped like ESPN's but not it.
 *
 * The endpoint is configured rather than hard-coded because the choice of
 * second provider is still open — DM-107 names the requirement, not the vendor.
 * What matters for B3-008 is that it is genuinely independent: a mirror of
 * ESPN's own data would corroborate ESPN's mistakes.
 */
export class SecondaryProvider implements SportsDataProvider {
  readonly name: string;
  readonly leagues = ["nfl", "wnba"] as const;

  private readonly http: ResilientJson;

  constructor(
    opts: { name: string; hosts: readonly string[]; pathFor: (league: LeagueSlug) => string },
    fetchImpl?: typeof fetch,
  ) {
    this.name = opts.name;
    this.pathFor = opts.pathFor;
    this.http = new ResilientJson(opts.hosts, fetchImpl);
  }

  private readonly pathFor: (league: LeagueSlug) => string;

  async getSlate(league: LeagueSlug): Promise<ProviderSlate> {
    const res = await this.http.get<unknown>(
      `${this.name}:slate:${league}`,
      this.pathFor(league),
      PREGAME_TTL_MS,
    );
    return {
      provider: this.name,
      league,
      events: parseGenericSlate(res.value, league),
      delayed: res.delayed,
      fetchedAt: res.fetchedAt,
    };
  }

  async getEvent(league: LeagueSlug, providerEventId: string): Promise<ProviderEvent | null> {
    const res = await this.http.get<unknown>(
      `${this.name}:event:${league}:${providerEventId}`,
      `${this.pathFor(league)}/${encodeURIComponent(providerEventId)}`,
      LIVE_TTL_MS,
    );
    try {
      return parseGenericEvent(res.value, league);
    } catch {
      return null;
    }
  }
}

/**
 * Minimal normalizer for a flat `{ games: [...] }` shape.
 *
 * Kept deliberately small: the second provider only has to answer "who won",
 * because that is the only question B3-008 asks of it. Odds, logos, and
 * in-progress detail all come from the primary.
 */
export function parseGenericEvent(raw: unknown, league: LeagueSlug): ProviderEvent {
  const rec = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  if (!rec) throw new ProviderShapeError("event is not an object");

  const idRaw = rec["id"];
  const id =
    typeof idRaw === "string"
      ? idRaw
      : typeof idRaw === "number" && Number.isFinite(idRaw)
        ? String(idRaw)
        : "";
  const homeAbbr = typeof rec["home"] === "string" ? rec["home"] : "";
  const awayAbbr = typeof rec["away"] === "string" ? rec["away"] : "";
  if (id === "" || homeAbbr === "" || awayAbbr === "") {
    throw new ProviderShapeError("event missing id or teams");
  }

  const startsAt = typeof rec["startsAt"] === "number" ? rec["startsAt"] : Number.NaN;
  if (!Number.isFinite(startsAt)) throw new ProviderShapeError("event has no startsAt");

  const statusRaw = typeof rec["status"] === "string" ? rec["status"].toLowerCase() : "";
  const status =
    statusRaw === "final"
      ? ("final" as const)
      : statusRaw === "in_progress"
        ? ("in_progress" as const)
        : statusRaw === "scheduled"
          ? ("scheduled" as const)
          : statusRaw === "postponed"
            ? ("postponed" as const)
            : statusRaw === "cancelled"
              ? ("cancelled" as const)
              : ("unknown" as const);

  const homeScore = typeof rec["homeScore"] === "number" ? rec["homeScore"] : undefined;
  const awayScore = typeof rec["awayScore"] === "number" ? rec["awayScore"] : undefined;

  return {
    providerEventId: id,
    league,
    startsAt,
    status,
    home: {
      providerId: homeAbbr,
      key: teamKey(league, homeAbbr),
      name: homeAbbr,
      abbreviation: homeAbbr,
    },
    away: {
      providerId: awayAbbr,
      key: teamKey(league, awayAbbr),
      name: awayAbbr,
      abbreviation: awayAbbr,
    },
    ...(homeScore !== undefined ? { homeScore } : {}),
    ...(awayScore !== undefined ? { awayScore } : {}),
  };
}

export function parseGenericSlate(payload: unknown, league: LeagueSlug): ProviderEvent[] {
  const root =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  const games = root?.["games"];
  if (!Array.isArray(games)) throw new ProviderShapeError("payload has no games array");

  const out: ProviderEvent[] = [];
  for (const raw of games) {
    try {
      out.push(parseGenericEvent(raw, league));
    } catch {
      // Skip one bad row rather than lose the slate, as with ESPN.
    }
  }
  return out;
}

/** The outcome of comparing two providers on one event. */
export type Corroboration =
  | { kind: "agreed"; winningOutcomeIndex: number }
  | { kind: "single-source"; reason: string }
  | { kind: "disagreed"; reason: string; primary: string; secondary: string };

/**
 * Compare two providers on a finished game (B3-008).
 *
 * `agreed` is the only result that authorises settlement. Both other results
 * route to manual review (B4-004), and they are kept distinct because they mean
 * different things operationally: `single-source` is usually a coverage gap and
 * resolves itself, while `disagreed` means one of two sources is wrong about a
 * result and needs a person now.
 *
 * Teams are matched on the provider-agnostic key (B3-004), not on provider ids,
 * which is the whole reason those keys exist.
 */
export function corroborate(
  primary: ProviderEvent,
  secondary: ProviderEvent | null,
): Corroboration {
  if (!secondary) {
    return { kind: "single-source", reason: "secondary provider does not know this event" };
  }

  if (primary.home.key !== secondary.home.key || primary.away.key !== secondary.away.key) {
    // Same event id, different teams: the two providers are describing different
    // games, so neither can corroborate the other.
    return {
      kind: "disagreed",
      reason: "providers disagree on the teams",
      primary: `${primary.home.key} v ${primary.away.key}`,
      secondary: `${secondary.home.key} v ${secondary.away.key}`,
    };
  }

  if (primary.status !== "final" || secondary.status !== "final") {
    return {
      kind: "single-source",
      reason: `not both final (primary ${primary.status}, secondary ${secondary.status})`,
    };
  }

  const pWinner = winnerOf(primary);
  const sWinner = winnerOf(secondary);
  if (pWinner === null || sWinner === null) {
    return { kind: "single-source", reason: "a provider reported final without a decisive score" };
  }

  if (pWinner !== sWinner) {
    logger.error(
      { event: primary.providerEventId, pWinner, sWinner },
      "sports: providers disagree on the winner — escalating to manual review",
    );
    return {
      kind: "disagreed",
      reason: "providers disagree on the winner",
      primary: scoreline(primary),
      secondary: scoreline(secondary),
    };
  }

  // Scores can differ slightly between sources on a corrected stat line while
  // the winner is the same. The winner is what settles a moneyline, so that is
  // what has to match — requiring identical scores would escalate on trivia.
  return { kind: "agreed", winningOutcomeIndex: pWinner };
}

function winnerOf(e: ProviderEvent): number | null {
  if (e.homeScore === undefined || e.awayScore === undefined) return null;
  if (e.homeScore === e.awayScore) return null;
  return e.homeScore > e.awayScore ? 0 : 1;
}

function scoreline(e: ProviderEvent): string {
  return `${e.home.abbreviation} ${String(e.homeScore ?? "?")} - ${String(e.awayScore ?? "?")} ${e.away.abbreviation}`;
}
