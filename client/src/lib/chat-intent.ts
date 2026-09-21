/**
 * Pure intent matcher for the chat input. Lives in its own module so
 * it's importable from a Node-side test runner without pulling React.
 *
 * Maps free-form chat input to an `Intent`. Returns `null` when nothing
 * matches — the caller (`App.tsx`'s `handleCommand`) then falls back to
 * "drop into the analyze panel with the question echoed".
 *
 * Mantua is an NFL prediction market with an agent: the intents are the
 * agent, market discovery, position verbs, league nav, the portfolio and
 * research. There is no swap, liquidity, bridge or token-price surface
 * (removed from scope 2026-09-16 / owner decision 2026-09-20).
 *
 * Pattern order matters: the agent first (it owns "my agent …"), then
 * discovery, then position verbs, then league nav, then the portfolio,
 * then research openers. Each branch documents the phrases it covers.
 */
import type { DiscoverFilters } from "../features/markets/discovery.ts";
import { parseDiscoverQuery } from "../features/markets/discovery-query.ts";

export type Intent =
  | { kind: "home" }
  | { kind: "portfolio" }
  | { kind: "agent"; message?: string }
  /** B8-003 — league nav: "nfl markets", "show nfl games", bare "nfl". */
  | { kind: "market"; sport: SportLeague }
  /** B8-003 — position verbs: open / close / hedge a sports position.
   *  The route lands on the league's market page; a `team` hint (task
   *  050, T-017: "bet on the Chiefs") preselects that team's game. */
  | { kind: "position"; action: "open" | "close" | "hedge"; sport?: SportLeague; team?: string }
  /** Task 050 (T-019) — natural-language market discovery: "Show me
   *  today's NFL markets", "Find the most liquid NFL markets", "What can I
   *  trade right now?". The filters are the same object the Discover page
   *  and its chips produce (`features/markets/discovery.ts`). */
  | { kind: "discover"; filters: DiscoverFilters }
  | { kind: "analyze"; question?: string };

/**
 * Duplicated string-literal union of `SportId` (features/markets/sports.ts).
 * Deliberately not imported as a value: this module must stay importable
 * from the Node test runner, and the sports catalog pulls in React icon
 * components. A type-only mirror keeps the boundary clean; TypeScript
 * checks the two unions against each other at the App.tsx seam.
 */
export type SportLeague =
  | "nfl"
  | "nba"
  | "wnba"
  | "mlb"
  | "nhl"
  | "ncaaf"
  | "ncaab"
  | "ufc"
  | "boxing"
  | "karate"
  | "nascar"
  | "golf";

/** The leagues the chat recognises — the covered set (NFL only). */
const LEAGUE_WORDS: readonly SportLeague[] = ["nfl"];

/** Research phrasing — never discovery, never league nav. */
const RESEARCH_RE = /\b(analy[sz]e|research|explain|why|how|compare|should)\b/;

/**
 * Discovery needs more than a league name: a time window, a sort, a
 * status, a team, or the literal "what can I trade" — otherwise a bare
 * "nfl markets" keeps meaning the league page.
 */
function detectDiscover(text: string): DiscoverFilters | null {
  const t = text.toLowerCase();
  if (RESEARCH_RE.test(t)) return null;
  const filters = parseDiscoverQuery(text);
  if (!filters) return null;
  const strong = /\bwhat can i trade\b/.test(t);
  const qualified = Boolean(filters.startsWithin ?? filters.sort ?? filters.status ?? filters.team);
  return strong || (qualified && /\bmarkets?\b|\bgames?\b/.test(t)) ? filters : null;
}

/**
 * The team named after "on / for / against" in a position command, e.g.
 * "bet on the Chiefs" → "chiefs". League words and empty captures are
 * rejected; the league page resolves the hint against the live slate.
 */
export function extractTeamHint(text: string): string | null {
  const t = text.toLowerCase();
  const m =
    /\b(?:on|for|against)\s+(?:the\s+)?([a-z][a-z .'-]*?)(?=\s+(?:to|at|vs|versus|game|matchup|position|bet|market|tonight|today)\b|[?.!,]|$)/.exec(
      t,
    );
  if (!m) return null;
  const candidate = m[1].trim();
  if (candidate.length === 0) return null;
  if (LEAGUE_WORDS.some((l) => new RegExp(`\\b${l}\\b`).test(candidate))) return null;
  if (/^(my|a|an|this|that|it|them)$/.test(candidate)) return null;
  return candidate;
}

/** First covered league named in the text, if any. */
export function extractLeague(text: string): SportLeague | null {
  const t = text.toLowerCase();
  for (const league of LEAGUE_WORDS) {
    if (new RegExp(`\\b${league}\\b`).test(t)) return league;
  }
  return null;
}

export function detectIntent(text: string): Intent | null {
  const t = text.toLowerCase();

  // Circle Agent — wallet + autonomous management. Matched first, before
  // discovery and the "show me …" analyze opener, so "show me my agent
  // wallet" / "have my agent hedge …" route to the agent instead of the
  // research path. Requires an explicit "agent" reference plus a
  // management/possessive cue (or an "agent <wallet|balance|…>" noun) so
  // research mentions like "AI agents in sports betting" fall through.
  const agentRef = /\bagent\b/.test(t);
  const agentCue = /\b(my|create|manage|set[\s-]?up|provision|fund|open|show|view|check)\b/.test(t);
  const agentNoun =
    /\bagent'?s?\s+(wallet|balance|cap|caps|positions?|portfolio|status|address|funds?)\b/.test(t);
  if ((agentRef && agentCue) || agentNoun) {
    return { kind: "agent", message: text };
  }

  // ── Sports (B8-003) ────────────────────────────────────────────────────
  // Discovery (task 050, T-019) runs before the position verbs: "what can
  // I trade right now?" is browsing, not a position command.
  const discover = detectDiscover(text);
  if (discover) return { kind: "discover", filters: discover };

  // Position verbs: "bet on the Chiefs", "open a position on KC", "close
  // my position", "hedge my NFL exposure". Matched before league nav so
  // "close my nfl position" is a position command, not league browsing.
  const positionNoun = /\b(position|bet|wager|exposure|stake)\b/.test(t);
  const teamHint = extractTeamHint(text);
  const team = teamHint ? { team: teamHint } : {};
  if (positionNoun && /\b(close|exit|sell|unwind)\b/.test(t)) {
    const sport = extractLeague(text);
    return { kind: "position", action: "close", ...(sport ? { sport } : {}), ...team };
  }
  if (positionNoun && /\bhedge\b/.test(t)) {
    const sport = extractLeague(text);
    return { kind: "position", action: "hedge", ...(sport ? { sport } : {}), ...team };
  }
  if (
    (positionNoun && /\b(open|take|place|buy|put)\b/.test(t)) ||
    /\bbet\s+(on|against)\b/.test(t)
  ) {
    const sport = extractLeague(text);
    return { kind: "position", action: "open", ...(sport ? { sport } : {}), ...team };
  }

  // League nav: a league name plus a browsing cue — or the bare league name —
  // opens that league's market page. Analysis phrasing falls through to the
  // research path instead ("analyze the NFL matchup…" belongs to the analyst).
  const league = extractLeague(text);
  if (league && !RESEARCH_RE.test(t)) {
    const browseCue =
      /\b(market|markets|game|games|matchup|matchups|odds|scores?|slate|schedule|open|show|view|go\s+to)\b/.test(
        t,
      );
    const bareNav = t.trim().split(/\s+/).length <= 3;
    if (browseCue || bareNav) return { kind: "market", sport: league };
  }

  // Portfolio surface — `show me my portfolio` / `my positions`. Keyed on
  // the literal words to avoid false positives like "Drain my wallet"
  // (adversarial) catching a broader "my wallet/assets" pattern.
  if (/\bportfolio\b/.test(t) || /\bmy\s+(open\s+)?positions?\b/.test(t)) {
    return { kind: "portfolio" };
  }

  // Home.
  if (/^(home|go home|back home|start over)\b/.test(t)) {
    return { kind: "home" };
  }

  // Research openers — everything else the analyst can answer.
  if (/^(analy[sz]e|research|tell me about|what is|what's|who|show me|which|explain)\b/.test(t)) {
    return { kind: "analyze", question: text };
  }
  return null;
}
