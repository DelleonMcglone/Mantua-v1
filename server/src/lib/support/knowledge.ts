import { AGENT_MODES } from "../agent/agent-mode.ts";

/**
 * Task 070 / AE-007 — the support knowledge base: short, factual answers
 * to the questions users ask most, kept as code so a test can check the
 * facts against the constants they describe. The support agent must cite
 * a topic for any claim about how Mantua works; it never improvises one.
 */

export interface KnowledgeTopic {
  id: string;
  title: string;
  keywords: readonly string[];
  body: string;
}

export const KNOWLEDGE: readonly KnowledgeTopic[] = [
  {
    id: "markets",
    title: "How a market works",
    keywords: ["market", "yes", "no", "probability", "price", "odds", "resolve", "redeem", "void"],
    body: "Each scheduled game is one market with a YES/NO token pair backed 1:1 by USDC. A YES token pays 1 USDC if the outcome happens and 0 if not, so its price is the market's implied probability: a YES at 0.62 is a 62% chance. You can buy or sell before and during the game. Trading closes when the game goes final; the market then resolves from live game data and winning tokens redeem 1:1 for USDC. A postponed or cancelled game is voided and collateral is returned.",
  },
  {
    id: "trading",
    title: "Placing and closing a trade",
    keywords: ["trade", "buy", "sell", "ticket", "confirm", "close", "position", "slippage", "fee"],
    body: "Open a league page, tap a price to load the ticket, enter an amount and press Confirm. The ticket shows the exact fee before you confirm: 0% in the regular season, a dynamic 0.10%–0.70% in the playoffs. A trade is confirmed on chain before it shows as executed; the ticket reports pending, confirmed or failed from the server's own verification. To close, open the position and use Close, which pre-fills a sell of the full balance.",
  },
  {
    id: "deposits",
    title: "Deposits",
    keywords: ["deposit", "fund", "add funds", "bank", "ach", "usdc", "wire"],
    body: "Deposit by bank transfer (through the regulated on-ramp partner, which handles identity checks and holds funds only during conversion) or by sending USDC on Base to your wallet address from the Profile page. A bank deposit shows as pending until the partner confirms it, then as complete; USDC sent on chain appears as soon as the transfer confirms.",
  },
  {
    id: "withdrawals",
    title: "Withdrawals",
    keywords: ["withdraw", "withdrawal", "cash out", "payout", "bank account"],
    body: "Withdraw to a linked bank account from the Profile page, or send USDC to any Base address. A bank withdrawal shows pending, then processing, then complete; a failed one names the reason and whether to retry or contact support. Winning positions must be redeemed to USDC before that USDC can be withdrawn.",
  },
  {
    id: "positions",
    title: "Positions and P&L",
    keywords: ["positions", "portfolio", "pnl", "p&l", "unrealized", "realized", "value", "mark"],
    body: "Open positions are marked at the live pool price, with the average entry price and unrealized P&L from your own fills. Settled positions show the realized result once the market resolves and whether the winning tokens have been redeemed. The activity timeline lists every trade, transfer, and agent action with its status.",
  },
  {
    id: "agent",
    title: "Your agent",
    keywords: ["agent", "autonomous", "confirm", "policy", "cap", "wallet", "mode", "simulation"],
    body: `Your agent runs a separate wallet with a daily spending cap and a policy you set: per-trade stake, risk level, leagues, and hedging limits. The platform runs it in one of these modes: ${AGENT_MODES.join(", ")}. In the default user-testing mode every money-moving action is previewed and executes only after you reply "confirm" in your own message. Autonomous execution also needs your policy's auto-trade switch. The agent's public performance page, if you claim a handle, is derived from chain-verified trades and cannot be edited.`,
  },
  {
    id: "voice",
    title: "Voice input",
    keywords: ["voice", "microphone", "speak", "talk", "transcription"],
    body: "Hold the microphone button to speak; the words arrive in the command bar as text and take the same path a typed command does. Speech can ask for anything but can never confirm a trade: Confirm stays a press. If the microphone is unavailable the text input keeps working.",
  },
  {
    id: "fees-and-network",
    title: "Fees, gas and the network",
    keywords: ["gas", "network", "base", "chain", "fees", "eth"],
    body: "Mantua runs on Base. Trades made through the app are designed to be gasless for you; the agent's wallet holds a little ETH for its own transactions. Market fees are shown on the ticket before you confirm; there are no hidden platform fees.",
  },
  {
    id: "safety",
    title: "Safety and limits",
    keywords: ["safe", "limits", "kill switch", "halted", "paused", "status", "delayed"],
    body: "The status banner reports whether reads are live or delayed and whether trading is open, halted for buys, or paused. Trading halts automatically when the live data feed is stale, and a platform-wide kill switch can pause every write. Your agent's spending is bounded by its daily cap and your policy at all times.",
  },
];

/** Rank topics by keyword and title hits for a free-text question. */
export function searchKnowledge(query: string, limit = 3): KnowledgeTopic[] {
  const words = query.toLowerCase().match(/[a-z&]+/g) ?? [];
  const scored = KNOWLEDGE.map((t) => {
    const hay = `${t.title} ${t.keywords.join(" ")}`.toLowerCase();
    const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
    return { t, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.t);
}

export function topicById(id: string): KnowledgeTopic | null {
  return KNOWLEDGE.find((t) => t.id === id) ?? null;
}
