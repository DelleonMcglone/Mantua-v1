/**
 * The non-transactional prompt of the demo, generated from today's slate so
 * every matchup, score, record, kickoff and line it quotes is the data the
 * board shows. Played through the real Analyze panel; the one judgement
 * line ("the market I'd watch") is authored, and the turn places no trade.
 */
import { etTime, sundayEvents } from "./clock.ts";
import type { DemoEvent } from "./snapshot.ts";
import { done, result, start, words, type Turn } from "./turns.ts";

export const ANALYZE_PROMPT = "What should I be watching in today's NFL games?";

const NUMBER_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
];
const count = (n: number): string => NUMBER_WORDS.at(n) ?? String(n);
const withRecord = (t: DemoEvent["home"]): string =>
  t.record ? `${t.name} (${t.record})` : t.name;

/** The side the posted line favours, with its probability in whole percent. */
function favourite(e: DemoEvent): { name: string; pct: number } {
  const home = e.homeWinProbabilityBps ?? 5000;
  return home >= 5000
    ? { name: e.home.name, pct: Math.round(home / 100) }
    : { name: e.away.name, pct: Math.round((10_000 - home) / 100) };
}

const score = (e: DemoEvent): string =>
  `${e.away.abbreviation} ${String(e.awayScore ?? 0)}, ${e.home.abbreviation} ${String(e.homeScore ?? 0)}`;
const upcomingLine = (e: DemoEvent): string => {
  const f = favourite(e);
  return `${e.away.name} at ${e.home.name}, ${etTime(e.startsAt)} ET — ${f.name} ${String(f.pct)}%`;
};

/** The game whose line sits closest to a coin flip: upcoming first, else live. */
export function featuredGame(events: readonly DemoEvent[]): DemoEvent | null {
  const today = sundayEvents(events);
  const pool = today.filter((e) => e.status === "scheduled");
  const candidates = pool.length > 0 ? pool : today.filter((e) => e.status === "in_progress");
  const byEdge = [...candidates].sort(
    (a, b) =>
      Math.abs((a.homeWinProbabilityBps ?? 5000) - 5000) -
      Math.abs((b.homeWinProbabilityBps ?? 5000) - 5000),
  );
  return byEdge.at(0) ?? today.at(0) ?? null;
}

export function analyzeTurn(events: readonly DemoEvent[]): Turn {
  const today = sundayEvents(events);
  const finals = today.filter((e) => e.status === "final");
  const live = today.filter((e) => e.status === "in_progress");
  const upcoming = today.filter((e) => e.status === "scheduled");
  const featured = featuredGame(events);

  const parts: string[] = [`${count(today.length)} NFL games today.`];
  if (finals.length > 0) parts.push(`Final: ${finals.slice(0, 3).map(score).join("; ")}.`);
  if (live.length > 0) parts.push(`In progress: ${live.slice(0, 3).map(score).join("; ")}.`);
  if (upcoming.length > 0) {
    parts.push(`Still to come: ${upcoming.slice(0, 3).map(upcomingLine).join("; ")}.`);
  }

  const pick = featured
    ? (() => {
        const f = favourite(featured);
        return (
          `The market I'd watch is ${withRecord(featured.away)} at ${withRecord(featured.home)}: ` +
          `${f.name} priced at ${String(f.pct)}% to win is close to a coin flip, where a small edge ` +
          "in the live number is worth the most. "
        );
      })()
    : "";

  return {
    prompt: ANALYZE_PROMPT,
    frames: [
      ...words(
        "Reading today's slate, the live scores and the posted lines — all free, from Mantua's own data. ",
      ),
      start("a1", "get_sports_slate"),
      result("a1", "get_sports_slate", { games: today.length }),
      start("a2", "get_recent_games", 300),
      result("a2", "get_recent_games", { rows: today.length * 2 }),
      ...words(`${parts.join(" ")} `),
      start("a3", "mantua_search_markets", 400),
      result("a3", "mantua_search_markets", { rows: today.length }),
      ...words(pick),
      ...words("No trade placed — your call."),
      done,
    ],
  };
}
