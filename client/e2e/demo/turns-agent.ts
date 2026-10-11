/**
 * The agent's "create / manage" turn for the demo: the chat's own
 * "Create / Manage Agent" chip sends "Create and manage agent wallet"; the
 * agent reads the Circle wallet and reports it as the "Agent wallet" card
 * (address, daily cap, status). No money moves.
 */
import { AGENT_ADDRESS, DAILY_CAP_USD } from "./mocks.ts";
import { done, result, session, start, words, type Turn } from "./turns.ts";

export const AGENT_WALLET_TURN: Turn = {
  prompt: "Create and manage agent wallet",
  frames: [
    session,
    ...words("Checking your agent wallet. "),
    start("w1", "manage_wallet"),
    result(
      "w1",
      "manage_wallet",
      { address: AGENT_ADDRESS, dailyCapUsd: DAILY_CAP_USD, status: "active" },
      1100,
    ),
    ...words(
      "Your agent wallet is live and funded with 250 USDC. It can spend up to " +
        `$${String(DAILY_CAP_USD)} a day, previews every trade first, and only acts after ` +
        "you reply “confirm”. Your limits live under Profile → Agent.",
    ),
    done,
  ],
};
