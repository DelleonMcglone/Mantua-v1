/** The real NFL Week 5 slate (ESPN, 2026-10-04) in the public-slate wire
 *  shape, for the demo's board shot. Probabilities from the posted lines. */
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
export function week5Slate() {
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
