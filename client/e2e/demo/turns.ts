/**
 * The three authored turns of the landing-page demo (owner, 2026-10-04):
 * prompts 1, 2 and 6 of the starter set, played through the real agent UI
 * from a scripted stream. Matchups, records and lines are the real NFL
 * Week 5 slate (ESPN, fetched 2026-10-04); the analysis is written for the
 * demo and labelled illustrative on the closing card.
 */
export interface Frame {
  /** Milliseconds to wait before this frame is sent. */
  wait: number;
  event: Record<string, unknown>;
}

const text = (delta: string, wait = 60): Frame => ({ wait, event: { type: "text", delta } });
const start = (id: string, tool: string, wait = 400): Frame => ({
  wait,
  event: { type: "tool_start", id, tool, args: {} },
});
const result = (id: string, tool: string, data: unknown, wait = 900): Frame => ({
  wait,
  event: { type: "tool_result", id, tool, ok: true, data },
});
/** Stream a sentence word by word, like a model does. */
function words(s: string, perWord = 45): Frame[] {
  return s.split(/(?<=\s)/).map((w, i) => text(w, i === 0 ? 250 : perWord));
}
const done: Frame = { wait: 300, event: { type: "done" } };
const session: Frame = { wait: 0, event: { type: "session", sessionId: "demo" } };

export const TURN_1 = {
  prompt: "What sports markets should I be watching today?",
  frames: [
    session,
    ...words(
      "Reading today's slate, team form and the injury reports — all free, from Mantua's own data. ",
    ),
    start("a1", "get_sports_slate"),
    result("a1", "get_sports_slate", { games: 15 }),
    start("a2", "get_recent_games", 300),
    result("a2", "get_recent_games", { rows: 30 }),
    start("a3", "get_player_injury_status", 300),
    result("a3", "get_player_injury_status", { injuries: 41 }),
    ...words("Fifteen games this week, two teams on bye. Five markets stand out:"),
    start("a4", "mantua_search_markets", 500),
    result("a4", "mantua_search_markets", {
      rows: [
        {
          matchup: "Raiders at Patriots",
          status: "open",
          homeWinProbabilityBps: 6100,
          liveOdds: true,
        },
        {
          matchup: "49ers at Seahawks",
          status: "open",
          homeWinProbabilityBps: 5900,
          liveOdds: true,
        },
        {
          matchup: "Vikings at Saints",
          status: "open",
          homeWinProbabilityBps: 4300,
          liveOdds: true,
        },
        {
          matchup: "Bears at Packers",
          status: "open",
          homeWinProbabilityBps: 5700,
          liveOdds: true,
        },
        { matchup: "Bills at Rams", status: "open", homeWinProbabilityBps: 5700, liveOdds: true },
      ],
    }),
    ...words(
      "Raiders at Patriots is the one to watch. Las Vegas is 3-0, New England 1-2, yet the market makes the Patriots 61% at home — the pricing leans on last season, not this one. ",
    ),
    ...words(
      "San Francisco at Seattle: both undefeated-or-close, the market has Seattle 59% on home field. The 49ers' pass rush is the evidence the price may be ignoring. ",
    ),
    ...words(
      "Minnesota at New Orleans, Chicago at Green Bay and Buffalo at Los Angeles are all within a field goal — small edges, but liquid markets. ",
    ),
    ...words("Want me to take a deeper look at any of these?"),
    done,
  ],
};

export const TURN_2 = {
  prompt: "Take a deeper look at Raiders at Patriots.",
  frames: [
    session,
    ...words("Researching Las Vegas at New England: form, injuries, head to head and the market. "),
    start("b1", "get_recent_games"),
    result("b1", "get_recent_games", { rows: 8 }),
    ...words(
      "The Raiders have won three straight, two of them on the road, by an average of 9 points. The Patriots are 1-2 and have trailed at halftime in all three games. ",
    ),
    start("b2", "get_player_injury_status", 300),
    result("b2", "get_player_injury_status", { injuries: 5 }),
    ...words(
      "New England lists two starting offensive linemen as questionable; Las Vegas is at full strength. ",
    ),
    start("b3", "call_paid_service", 300),
    result("b3", "call_paid_service", {
      available: true,
      provider: "Exa",
      service: "https://api.exa.ai/search",
      usdCost: 0.01,
    }),
    ...words(
      "Beat reporters this week point the same way: the Raiders' defense is top five in pressure rate, and the Patriots have the league's slowest-starting offense. ",
    ),
    start("b4", "mantua_analyze_market", 400),
    result("b4", "mantua_analyze_market", { status: "ok" }),
    start("b5", "mantua_compare_markets", 300),
    result("b5", "mantua_compare_markets", {
      status: "ok",
      budgetUsdc: null,
      rows: [
        {
          game: "Las Vegas Raiders at New England Patriots",
          team: "Las Vegas Raiders",
          priceBps: 3900,
          moveTodayPoints: 1.5,
          rating: "Lean YES",
          rationale:
            "Mantua 48% vs market 39% · gap +9.0 pts · medium confidence · 1,840 USDC in the pool",
        },
      ],
    }),
    ...words(
      "What the evidence establishes: form and health favour Las Vegas. What is uncertain: three games is a small sample, and New England was 7-1 at home last season. ",
    ),
    ...words(
      "What would change this thesis: a clean Patriots line by Friday, or a Raiders starter on the Sunday injury report. No trade placed — your call.",
    ),
    done,
  ],
};

export const TURN_6 = {
  prompt: "Find today's biggest probability gaps.",
  frames: [
    session,
    ...words(
      "Comparing Mantua's estimated probability with the market price on every open game this week. ",
    ),
    start("c1", "mantua_probability_gaps"),
    result("c1", "mantua_probability_gaps", { scanned: 15 }),
    start("c2", "get_market_liquidity", 300),
    result("c2", "get_market_liquidity", { markets: 15 }),
    ...words("Fifteen markets scanned. The five widest gaps:"),
    start("c3", "mantua_compare_markets", 500),
    result("c3", "mantua_compare_markets", {
      status: "ok",
      budgetUsdc: null,
      rows: [
        {
          game: "Las Vegas Raiders at New England Patriots",
          team: "Las Vegas Raiders",
          priceBps: 3900,
          moveTodayPoints: 1.5,
          rating: "Lean YES",
          rationale: "Mantua 48% · gap +9.0 pts · medium confidence · 1,840 USDC",
        },
        {
          game: "San Francisco 49ers at Seattle Seahawks",
          team: "San Francisco 49ers",
          priceBps: 4100,
          moveTodayPoints: 0.5,
          rating: "Lean YES",
          rationale: "Mantua 47% · gap +6.0 pts · medium confidence · 2,210 USDC",
        },
        {
          game: "Houston Texans at Tennessee Titans",
          team: "Houston Texans",
          priceBps: 7000,
          moveTodayPoints: -1.0,
          rating: "Lean NO",
          rationale: "Mantua 64% · gap −6.0 pts · low confidence · 960 USDC",
        },
        {
          game: "Buffalo Bills at Los Angeles Rams",
          team: "Buffalo Bills",
          priceBps: 4300,
          moveTodayPoints: 0.0,
          rating: "Lean YES",
          rationale: "Mantua 48% · gap +5.0 pts · medium confidence · 1,420 USDC",
        },
        {
          game: "Detroit Lions at Arizona Cardinals",
          team: "Detroit Lions",
          priceBps: 6800,
          moveTodayPoints: 0.5,
          rating: "Fair",
          rationale: "Mantua 66% · gap −2.0 pts · high confidence · 3,050 USDC",
        },
      ],
    }),
    ...words(
      "The widest gap is the Raiders: the market still prices New England as last year's team. The Texans gap runs the other way — 0-3 on both sides, and the market may be overrating Houston's talent gap. ",
    ),
    ...words(
      "Gaps narrow as the week's injury reports land and as the pools deepen on Saturday. No trades placed. I'll flag any gap that widens past 10 points.",
    ),
    done,
  ],
};
