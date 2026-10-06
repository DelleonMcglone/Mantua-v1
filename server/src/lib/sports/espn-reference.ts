/**
 * ESPN as a reference-data source (owner report 2026-10-05: the no-money
 * prompts came back empty in production). Injuries and standings are free
 * on ESPN's site API; until now only Sportradar fed them, and a trial
 * key's quota does not. The posted line lives in `espn-odds.ts`.
 *
 * Same rule as `espn.ts`: every field is read as `unknown` and validated;
 * a row that does not parse is dropped, never guessed.
 */
import {
  type LeagueSlug,
  type ProviderInjuryReport,
  type ProviderInjuryStatus,
  type ProviderTeamStanding,
  type SeasonType,
  teamKey,
} from "./provider.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── Injuries ────────────────────────────────────────────────────────────

const INJURY_STATUS: Partial<Record<string, ProviderInjuryStatus>> = {
  INJURY_STATUS_OUT: "out",
  INJURY_STATUS_DOUBTFUL: "doubtful",
  INJURY_STATUS_QUESTIONABLE: "questionable",
  INJURY_STATUS_PROBABLE: "probable",
  INJURY_STATUS_DAYTODAY: "day_to_day",
  INJURY_STATUS_IR: "ir",
  INJURY_STATUS_INJURY_RESERVE: "ir",
};

/** An injury report line plus the position the player upsert needs. */
export interface EspnInjuryReport extends ProviderInjuryReport {
  position?: string;
}

function athleteId(athlete: Rec, name: string, team: string): string {
  const direct = str(athlete["id"]);
  if (direct) return direct;
  for (const l of arr(athlete["links"])) {
    const m = /\/id\/(\d+)/.exec(str(rec(l)?.["href"]) ?? "");
    if (m?.[1]) return m[1];
  }
  // No id anywhere: a stable key from who they are, so the row is not lost.
  return `name:${team}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function parseInjuries(payload: unknown, league: LeagueSlug): EspnInjuryReport[] {
  const out: EspnInjuryReport[] = [];
  for (const teamRaw of arr(rec(payload)?.["injuries"])) {
    for (const raw of arr(rec(teamRaw)?.["injuries"])) {
      const item = rec(raw);
      const athlete = rec(item?.["athlete"]);
      const name = str(athlete?.["displayName"]);
      const abbr = str(rec(athlete?.["team"])?.["abbreviation"]);
      const status = INJURY_STATUS[str(rec(item?.["type"])?.["name"]) ?? ""];
      if (!item || !athlete || !name || !abbr || !status) continue;
      const details = rec(item["details"]);
      const what = [str(details?.["type"]), str(details?.["detail"])].filter(Boolean).join(" — ");
      const at = Date.parse(str(item["date"]) ?? "");
      const position = str(rec(athlete["position"])?.["abbreviation"]);
      out.push({
        providerPlayerId: athleteId(athlete, name, abbr),
        playerName: name,
        teamKey: teamKey(league, abbr),
        status,
        ...(what ? { description: what } : {}),
        ...(Number.isFinite(at) ? { providerUpdatedAt: Math.floor(at / 1000) } : {}),
        ...(position ? { position } : {}),
      });
    }
  }
  return out;
}

// ── Standings ───────────────────────────────────────────────────────────

const SEASON_TYPE: Partial<Record<number, SeasonType>> = {
  1: "preseason",
  2: "regular",
  3: "postseason",
};

export function parseStandings(payload: unknown, league: LeagueSlug): ProviderTeamStanding[] {
  const root = rec(payload);
  const out: ProviderTeamStanding[] = [];
  for (const confRaw of arr(root?.["children"])) {
    const standings = rec(rec(confRaw)?.["standings"]);
    const season = num(standings?.["season"]);
    const seasonType = SEASON_TYPE[num(standings?.["seasonType"]) ?? 2] ?? "regular";
    if (season === undefined) continue;
    for (const entryRaw of arr(standings?.["entries"])) {
      const entry = rec(entryRaw);
      const team = rec(entry?.["team"]);
      const id = str(team?.["id"]);
      const abbr = str(team?.["abbreviation"]);
      if (!id || !abbr) continue;
      const stats = new Map<string, Rec>();
      for (const s of arr(entry?.["stats"])) {
        const r = rec(s);
        const name = str(r?.["name"]);
        if (r && name) stats.set(name, r);
      }
      const value = (k: string) => num(stats.get(k)?.["value"]);
      const display = (k: string) => str(stats.get(k)?.["displayValue"]);
      const wins = value("wins");
      const losses = value("losses");
      if (wins === undefined || losses === undefined) continue;
      const seed = value("playoffSeed");
      const streak = display("streak");
      const homeRecord = display("Home");
      const awayRecord = display("Road");
      const pf = value("pointsFor");
      const pa = value("pointsAgainst");
      const numeric: Record<string, number> = {};
      for (const k of ["winPercent", "pointDifferential", "divisionWins", "divisionLosses"]) {
        const v = value(k);
        if (v !== undefined) numeric[k] = v;
      }
      out.push({
        providerTeamId: id,
        teamKey: teamKey(league, abbr),
        season: String(season),
        seasonType,
        wins,
        losses,
        ties: value("ties") ?? 0,
        ...(seed !== undefined && seed > 0 ? { conferenceRank: seed } : {}),
        ...(pf !== undefined ? { pointsFor: pf } : {}),
        ...(pa !== undefined ? { pointsAgainst: pa } : {}),
        ...(streak ? { streak } : {}),
        ...(homeRecord ? { homeRecord } : {}),
        ...(awayRecord ? { awayRecord } : {}),
        stats: numeric,
      });
    }
  }
  return out;
}
