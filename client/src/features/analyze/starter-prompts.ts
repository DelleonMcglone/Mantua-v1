/**
 * "Start Trading With Your First Five Prompts" — the analyst's starter
 * cards (owner, 2026-10-03). They walk the agent workflow in order: find an
 * opportunity, research it, work out the trade, size it, execute and manage
 * it. A prompt that names a game or team the user must choose is put into
 * the dock for editing instead of being sent as is.
 */
export interface StarterPrompt {
  step: number;
  title: string;
  /** The one-line ask shown on the card and sent as the first line. */
  headline: string;
  /** The full instruction that follows the headline. */
  body: string;
}

export const STARTER_PROMPTS_TITLE = "Start Trading With Your First Five Prompts";

export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    step: 1,
    title: "Find the games that matter",
    headline: "What sports markets should I be watching today?",
    body: "Review today's available sports markets and identify the 5 most interesting opportunities based on the current price, recent team performance, injuries, matchup data, and other relevant information. For each one, explain what the market is pricing in, what the key evidence says, and what could make the market mispriced. Cite your sources.",
  },
  {
    step: 2,
    title: "Build a thesis",
    headline: "Take a deeper look at [GAME].",
    body: "Research this matchup and tell me whether the current YES and NO prices appear consistent with the available evidence. Look at recent performance, injuries, lineups, matchup history, home and away performance, and any other factors that could materially affect the outcome. Separate what the evidence establishes from what is uncertain, and tell me what information would change the thesis.",
  },
  {
    step: 3,
    title: "Find the trade",
    headline: "I think [TEAM] will win. Show me how I could trade this market.",
    body: "Analyze the available YES and NO positions for this market. Show me the current prices, available liquidity, potential profit and loss, and the key risks of entering the position at the current price. Then compare entering now with waiting for a better price. Do not place a trade. Let me choose what to do.",
  },
  {
    step: 4,
    title: "Size the position",
    headline: "I want to risk $100 on this trade.",
    body: "Build a position around my $100 risk limit. Show me how many contracts I could buy, my entry price, maximum potential loss, potential profit, and the price at which it would make sense to take profit. Also show me what happens if the market moves 5%, 10%, and 20% in my favor or against me. Do not place the trade. Prepare it for my approval.",
  },
  {
    step: 5,
    title: "Execute and manage it",
    headline: "Execute the trade as prepared, then manage the position for me.",
    body: "Place the trade using the position we just structured. Before executing, confirm the market, side, price, quantity, and maximum risk. If anything has changed from the preview, stop and ask me first. After execution, monitor the position and notify me when the market reaches the conditions we established for taking profit, reducing risk, or exiting the position. Do not make a new trade without my approval.",
  },
];

const PLACEHOLDER = /\[(GAME|TEAM)\]/;

/** True when the user has to name a game or team before this can be sent. */
export function needsInput(p: StarterPrompt): boolean {
  return PLACEHOLDER.test(p.headline) || PLACEHOLDER.test(p.body);
}

/** The text a card sends or prefills: the headline, then the instruction. */
export function promptText(p: StarterPrompt): string {
  return `${p.headline}\n\n${p.body}`;
}
