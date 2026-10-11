/**
 * Today's real games for the demo: an ESPN scoreboard snapshot
 * (`espn-YYYYMMDD.json`, fetched by the owner — see README.md) converted
 * into the `PublicSlate` event shape the board renders. Mirrors the
 * server's ESPN mapping (`server/src/lib/sports/espn.ts`, `espn-odds.ts`)
 * for status, records, scores and the home-win line, so the recording
 * shows what production would have shown at the moment of the fetch.
 */
import { existsSync, readFileSync } from "node:fs";
import { homeWinBps } from "./snapshot-odds.ts";

export interface DemoTeam {
  key: string;
  name: string;
  abbreviation: string;
  record?: string;
  logo?: string;
}

export interface DemoEvent {
  providerEventId: string;
  startsAt: number;
  status: string;
  home: DemoTeam;
  away: DemoTeam;
  homeScore?: number;
  awayScore?: number;
  homeWinProbabilityBps?: number;
  liveOdds: boolean;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const STATUS_BY_NAME: Record<string, string> = {
  STATUS_SCHEDULED: "scheduled",
  STATUS_IN_PROGRESS: "in_progress",
  STATUS_HALFTIME: "in_progress",
  STATUS_END_PERIOD: "in_progress",
  STATUS_FINAL: "final",
  STATUS_FINAL_OVERTIME: "final",
  STATUS_POSTPONED: "postponed",
  STATUS_CANCELED: "cancelled",
  STATUS_SUSPENDED: "postponed",
  STATUS_DELAYED: "scheduled",
};
const STATUS_BY_STATE: Record<string, string> = {
  pre: "scheduled",
  in: "in_progress",
  post: "final",
};

function status(competition: Rec, event: Rec): string {
  const type = rec(rec(competition["status"] ?? event["status"])?.["type"]);
  const name = str(type?.["name"])?.toUpperCase();
  if (name && STATUS_BY_NAME[name]) return STATUS_BY_NAME[name];
  const state = str(type?.["state"])?.toLowerCase();
  return (state && STATUS_BY_STATE[state]) ?? "unknown";
}

function team(competitor: Rec): DemoTeam {
  const t = rec(competitor["team"]) ?? {};
  const abbreviation = str(t["abbreviation"]) ?? "?";
  const summary = str(rec(arr(competitor["records"])[0])?.["summary"]);
  const logo = str(t["logo"]);
  return {
    key: `nfl:${abbreviation}`,
    name: str(t["displayName"]) ?? abbreviation,
    abbreviation,
    ...(summary && /^\d{1,3}-\d{1,3}(-\d)?$/.test(summary) ? { record: summary } : {}),
    ...(logo ? { logo } : {}),
  };
}

/** The scoreboard payload's `events[]` as demo events; malformed entries are skipped. */
export function parseSnapshot(payload: unknown): DemoEvent[] {
  return arr(rec(payload)?.["events"]).flatMap((raw): DemoEvent[] => {
    const event = rec(raw);
    const competition = rec(arr(event?.["competitions"])[0]);
    if (!event || !competition) return [];
    const competitors = arr(competition["competitors"]).map(rec);
    const home = competitors.find((c) => c?.["homeAway"] === "home");
    const away = competitors.find((c) => c?.["homeAway"] === "away");
    const date = Date.parse(str(event["date"]) ?? "");
    if (!home || !away || !Number.isFinite(date)) return [];
    const homeScore = num(home["score"]);
    const awayScore = num(away["score"]);
    const line = homeWinBps(competition);
    return [
      {
        providerEventId: String(event["id"]),
        startsAt: Math.floor(date / 1000),
        status: status(competition, event),
        home: team(home),
        away: team(away),
        ...(homeScore !== undefined ? { homeScore } : {}),
        ...(awayScore !== undefined ? { awayScore } : {}),
        ...(line !== undefined ? { homeWinProbabilityBps: line } : {}),
        liveOdds: true,
      },
    ];
  });
}

/** The snapshot file for `day` (YYYYMMDD), or null when the owner has not fetched one. */
export function loadSnapshot(day: string): DemoEvent[] | null {
  const file = new URL(`./espn-${day}.json`, import.meta.url).pathname;
  if (!existsSync(file)) return null;
  return parseSnapshot(JSON.parse(readFileSync(file, "utf8")));
}
