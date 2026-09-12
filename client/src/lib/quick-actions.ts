/**
 * T-016 / T-017 — contextual quick actions for the dock. Each action is a
 * natural-language command, not a route: tapping a chip submits the
 * command through the same `handleCommand` path the user types into, so
 * the chips exercise intent switching instead of bypassing it. The test
 * proves every command re-detects to the intent it advertises.
 * Pure: no React.
 */

export type QuickActionId = "trade" | "analyze" | "swap" | "add-liquidity" | "portfolio" | "agent";

export interface QuickAction {
  id: QuickActionId;
  label: string;
  /** The command submitted to the dock. */
  command: string;
}

export interface QuickActionContext {
  kind:
    | "home"
    | "market"
    | "discover"
    | "analyze"
    | "swap"
    | "pools"
    | "profile"
    | "agent"
    | "other";
  sport?: "nba" | "wnba" | "nfl" | "mlb" | "nhl" | "soccer";
  /** The game in view, when there is one. */
  game?: { away: string; home: string };
}

/** Which action each surface already is, so its chip is dropped there. */
const OWN_ACTION: Partial<Record<QuickActionContext["kind"], QuickActionId>> = {
  analyze: "analyze",
  swap: "swap",
  pools: "add-liquidity",
  profile: "portfolio",
  agent: "agent",
  discover: "trade",
};

export function quickActionsFor(ctx: QuickActionContext): QuickAction[] {
  const league = ctx.sport ? ctx.sport.toUpperCase() : null;
  const matchup = ctx.game ? `${ctx.game.away} at ${ctx.game.home}` : null;

  const all: QuickAction[] = [
    {
      id: "trade",
      label: "Trade",
      command: league
        ? `What can I trade right now in the ${league}?`
        : "What can I trade right now?",
    },
    {
      id: "analyze",
      label: matchup ? "Analyze this game" : "Analyze",
      command: matchup
        ? `Analyze the ${matchup} matchup and what a prediction-market trader should watch`
        : "Analyze today's games and markets",
    },
    { id: "swap", label: "Swap", command: "Swap USDC for EURC" },
    { id: "add-liquidity", label: "Add liquidity", command: "Add liquidity to a USDC EURC pool" },
    { id: "portfolio", label: "Portfolio", command: "Show me my portfolio" },
    {
      id: "agent",
      label: matchup ? "Hedge with agent" : "Agent",
      command: matchup
        ? `Have my agent evaluate ${ctx.game?.away ?? ""} and manage my position`
        : "Show me my agent",
    },
  ];
  const own = OWN_ACTION[ctx.kind];
  return own ? all.filter((a) => a.id !== own) : all;
}
