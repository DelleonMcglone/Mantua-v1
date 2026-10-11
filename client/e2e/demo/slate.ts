/**
 * The demo's slate. `demoSlate()` serves today's ESPN snapshot when the
 * owner has fetched one (`snapshot.ts`) — statuses, scores, records and
 * lines as of that moment — and falls back to `week5Slate()`, the same
 * week's schedule as fetched on 2026-10-04 (every game scheduled, no
 * scores, the lines of that day), in the public-slate wire shape.
 */
import { DEMO_DAY } from "./clock.ts";
import { loadSnapshot, type DemoEvent } from "./snapshot.ts";

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
const team = (abbreviation: string, name: string) => ({
  key: `nfl:${abbreviation}`,
  name,
  abbreviation,
});
const T = {
  TB: team("TB", "Tampa Bay Buccaneers"),
  DAL: team("DAL", "Dallas Cowboys"),
  PHI: team("PHI", "Philadelphia Eagles"),
  JAX: team("JAX", "Jacksonville Jaguars"),
  CHI: team("CHI", "Chicago Bears"),
  GB: team("GB", "Green Bay Packers"),
  HOU: team("HOU", "Houston Texans"),
  TEN: team("TEN", "Tennessee Titans"),
  CIN: team("CIN", "Cincinnati Bengals"),
  MIA: team("MIA", "Miami Dolphins"),
  LV: team("LV", "Las Vegas Raiders"),
  NE: team("NE", "New England Patriots"),
  MIN: team("MIN", "Minnesota Vikings"),
  NO: team("NO", "New Orleans Saints"),
  CLE: team("CLE", "Cleveland Browns"),
  NYJ: team("NYJ", "New York Jets"),
  IND: team("IND", "Indianapolis Colts"),
  PIT: team("PIT", "Pittsburgh Steelers"),
  NYG: team("NYG", "New York Giants"),
  WSH: team("WSH", "Washington Commanders"),
  DEN: team("DEN", "Denver Broncos"),
  LAC: team("LAC", "Los Angeles Chargers"),
  DET: team("DET", "Detroit Lions"),
  ARI: team("ARI", "Arizona Cardinals"),
  SF: team("SF", "San Francisco 49ers"),
  SEA: team("SEA", "Seattle Seahawks"),
  BAL: team("BAL", "Baltimore Ravens"),
  ATL: team("ATL", "Atlanta Falcons"),
  BUF: team("BUF", "Buffalo Bills"),
  LAR: team("LAR", "Los Angeles Rams"),
};
// [away, home, kickoff (UTC), home win probability bps]
const GAMES: [keyof typeof T, keyof typeof T, string, number][] = [
  ["TB", "DAL", "2026-10-09T00:15:00Z", 7400],
  ["PHI", "JAX", "2026-10-11T13:30:00Z", 5700],
  ["CHI", "GB", "2026-10-11T17:00:00Z", 5700],
  ["HOU", "TEN", "2026-10-11T17:00:00Z", 3000],
  ["CIN", "MIA", "2026-10-11T17:00:00Z", 2800],
  ["LV", "NE", "2026-10-11T17:00:00Z", 6100],
  ["MIN", "NO", "2026-10-11T17:00:00Z", 4300],
  ["CLE", "NYJ", "2026-10-11T17:00:00Z", 4600],
  ["IND", "PIT", "2026-10-11T17:00:00Z", 5200],
  ["NYG", "WSH", "2026-10-11T17:00:00Z", 5700],
  ["DEN", "LAC", "2026-10-11T20:05:00Z", 4300],
  ["DET", "ARI", "2026-10-11T20:25:00Z", 3200],
  ["SF", "SEA", "2026-10-11T20:25:00Z", 5900],
  ["BAL", "ATL", "2026-10-12T00:20:00Z", 3100],
  ["BUF", "LAR", "2026-10-13T00:15:00Z", 5700],
];
export interface DemoSlate {
  leagues: {
    nfl: {
      league: "nfl";
      provider: "canonical";
      delayed: boolean;
      fetchedAt: number;
      events: DemoEvent[];
    };
  };
}

function wrap(events: DemoEvent[], fetchedAt: number): DemoSlate {
  return {
    leagues: { nfl: { league: "nfl", provider: "canonical", delayed: false, fetchedAt, events } },
  };
}

/** Today's real games when the snapshot exists, else the fallback schedule;
 *  `fetchedAt` sits a few seconds before the demo's pinned clock. */
export function demoSlate(nowMs: number): { slate: DemoSlate; source: "snapshot" | "fallback" } {
  const snapshot = loadSnapshot(DEMO_DAY);
  const fetchedAt = nowMs - 20_000;
  if (snapshot && snapshot.length > 0)
    return { slate: wrap(snapshot, fetchedAt), source: "snapshot" };
  return { slate: wrap(week5Slate().leagues.nfl.events, fetchedAt), source: "fallback" };
}

/** The events behind `demoSlate`, for the turns and the pinned clock. */
export function demoEvents(): DemoEvent[] {
  return loadSnapshot(DEMO_DAY) ?? week5Slate().leagues.nfl.events;
}

export function week5Slate(): DemoSlate {
  return {
    leagues: {
      nfl: {
        league: "nfl",
        provider: "canonical",
        delayed: false,
        fetchedAt: Date.now(),
        events: GAMES.map(([a, hm, kickoff, p], i) => ({
          providerEventId: String(401772000 + i),
          startsAt: at(kickoff),
          status: "scheduled",
          home: T[hm],
          away: T[a],
          homeWinProbabilityBps: p,
          liveOdds: true,
        })),
      },
    },
  };
}
