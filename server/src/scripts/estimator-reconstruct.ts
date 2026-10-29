/**
 * Task 079, slices 2–3 — rebuild the results-only part of the estimator for
 * every game of a season, using only finals that had ended before each
 * kickoff, and score it against outcomes.
 *
 *   npm run estimator:reconstruct -- [season=2026] [weeks=1-9]
 *   npm run estimator:reconstruct -- grid=1 train=1-4 test=5-7
 *
 * Reads ESPN's public scoreboard (no key, no secrets). The default prints a
 * Markdown report for the deployed weights. `grid=1` scores candidate
 * weights for the point-differential term (and a reduced record weight) on
 * the train weeks and the held-out test weeks separately, so a weight is
 * chosen on one and judged on the other. Partial inputs — no injuries, no
 * book line — so every number here is a lower bound, never the estimator's
 * score.
 */

import {
  reconstructSeason,
  scoreReconstruction,
  type GameRow,
  type ReconstructedForecast,
} from "../lib/forecast/reconstruct.ts";

const arg = (k: string, d: string): string =>
  process.argv.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1) ?? d;
const range = (s: string): [number, number] => s.split("-").map(Number) as [number, number];

async function fetchWeek(season: string, week: number): Promise<GameRow[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${String(week)}&dates=${season}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${String(res.status)} for week ${String(week)}`);
  const body = (await res.json()) as { events?: unknown[] };
  const rows: GameRow[] = [];
  for (const ev of body.events ?? []) {
    const e = ev as Record<string, unknown>;
    const comp = (e["competitions"] as Record<string, unknown>[] | undefined)?.[0];
    if (!comp) continue;
    const sides = (comp["competitors"] as Record<string, unknown>[]).map((c) => ({
      homeAway: c["homeAway"] as string,
      abbr: (c["team"] as Record<string, unknown>)["abbreviation"] as string,
      score: Number(c["score"] ?? 0),
    }));
    const home = sides.find((s) => s.homeAway === "home");
    const away = sides.find((s) => s.homeAway === "away");
    if (!home || !away) continue;
    const status = (comp["status"] as { type: { name: string } }).type.name;
    rows.push({
      id: String(e["id"]),
      startsAt: Date.parse(String(e["date"])),
      home: home.abbr,
      away: away.abbr,
      homeScore: home.score,
      awayScore: away.score,
      final: status === "STATUS_FINAL",
      week,
    });
  }
  return rows;
}

const fmt = (n: number | null, d = 4): string => (n === null ? "—" : n.toFixed(d));

function reportLine(label: string, rows: readonly ReconstructedForecast[]): string {
  const s = scoreReconstruction(rows);
  return `| ${label} | ${String(s.n)} | ${fmt(s.brier)} | ${fmt(s.logLoss)} | ${fmt(s.favouriteHitRate, 3)} |`;
}

function report(season: string, from: number, to: number, games: GameRow[]): void {
  const rows = reconstructSeason(games);
  const finals = rows.filter((r) => r.outcome !== null);
  console.log(
    `# Results-only reconstruction — ${season} regular season, weeks ${String(from)}–${String(to)}\n`,
  );
  console.log(
    `Games fetched: ${String(games.length)}; scored (final, not tied): ${String(finals.length)}. ` +
      "Inputs per game: venue, season record, point differential and last-5 form from finals that ended BEFORE kickoff. " +
      "No injuries, no book line, no prior-season head-to-head. Coin-flip Brier is 0.2500.\n",
  );
  console.log("| Slice | n | Brier | Log loss | Favourite hit rate |");
  console.log("|---|---|---|---|---|");
  console.log(reportLine("All", rows));
  const weeks = [...new Set(rows.map((r) => r.week))].filter((w): w is number => w !== null);
  for (const w of weeks)
    console.log(
      reportLine(
        `Week ${String(w)}`,
        rows.filter((r) => r.week === w),
      ),
    );
  const bins = new Map<number, { n: number; hits: number; sum: number }>();
  for (const r of finals) {
    const b = Math.min(9, Math.floor(r.homeProbabilityBps / 1000));
    const cur = bins.get(b) ?? { n: 0, hits: 0, sum: 0 };
    cur.n += 1;
    cur.hits += r.outcome === 1 ? 1 : 0;
    cur.sum += r.homeProbabilityBps;
    bins.set(b, cur);
  }
  console.log("\n| Home prob. bin | n | Mean predicted | Home win rate |");
  console.log("|---|---|---|---|");
  for (const [b, v] of [...bins.entries()].sort((x, y) => x[0] - y[0])) {
    console.log(
      `| ${String(b * 10)}–${String(b * 10 + 10)}% | ${String(v.n)} | ${(v.sum / v.n / 100).toFixed(1)}% | ${((100 * v.hits) / v.n).toFixed(1)}% |`,
    );
  }
}

/** Candidate weights: margin bps per point × record gap bps. */
function grid(games: GameRow[], train: [number, number], test: [number, number]): void {
  const inWeeks = (r: ReconstructedForecast, [a, b]: [number, number]) =>
    r.week !== null && r.week >= a && r.week <= b;
  console.log(
    `# Weight grid — train weeks ${String(train[0])}–${String(train[1])}, test weeks ${String(test[0])}–${String(test[1])}\n`,
  );
  console.log(
    "| margin bps/pt | record gap bps | n train | Brier train | n test | Brier test | Brier all |",
  );
  console.log("|---|---|---|---|---|---|---|");
  for (const recordGapBps of [5000, 2500, 0]) {
    for (const marginBpsPerPoint of [0, 100, 150, 200, 250, 300, 400]) {
      const rows = reconstructSeason(games, { marginBpsPerPoint, recordGapBps });
      const tr = scoreReconstruction(rows.filter((r) => inWeeks(r, train)));
      const te = scoreReconstruction(rows.filter((r) => inWeeks(r, test)));
      const all = scoreReconstruction(rows);
      console.log(
        `| ${String(marginBpsPerPoint)} | ${String(recordGapBps)} | ${String(tr.n)} | ${fmt(tr.brier)} | ${String(te.n)} | ${fmt(te.brier)} | ${fmt(all.brier)} |`,
      );
    }
  }
}

async function main(): Promise<void> {
  const season = arg("season", "2026");
  const [from, to] = range(arg("weeks", "1-9"));
  const games: GameRow[] = [];
  for (let w = from; w <= to; w += 1) games.push(...(await fetchWeek(season, w)));
  if (arg("grid", "0") === "1") grid(games, range(arg("train", "1-4")), range(arg("test", "5-7")));
  else report(season, from, to, games);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
