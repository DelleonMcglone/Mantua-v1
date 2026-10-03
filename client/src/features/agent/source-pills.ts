/**
 * Source pills — the inline "provider · category" chips a research turn
 * shows for each data read (the Coinbase for Agents pattern, owner
 * 2026-10-03). Pure: which tools are sources, what each pill says, and the
 * cost line for a paid call.
 */
export interface SourcePill {
  provider: string;
  category: string;
}

/** Mantua's own reads: free, from the canonical database. */
const MANTUA_SOURCES: Record<string, string> = {
  get_sports_slate: "schedule",
  mantua_search_markets: "markets",
  mantua_get_market: "market",
  mantua_analyze_market: "analysis",
  mantua_probability_gaps: "probability gaps",
  mantua_compare_markets: "summary",
  get_game: "schedule",
  get_live_game_state: "live game",
  get_team_stats: "team stats",
  get_player_stats: "player stats",
  get_player_injury_status: "injuries",
  get_recent_games: "recent form",
  get_head_to_head: "head to head",
  get_standings: "standings",
  get_play_by_play: "play by play",
  get_market_price: "price",
  get_market_history: "price history",
  get_market_volume: "volume",
  get_market_liquidity: "liquidity",
  get_nfl_schedule: "schedule",
};

const PAID_SOURCES = new Set(["call_paid_service", "search_paid_services"]);

export function isSourceTool(tool: string): boolean {
  return tool in MANTUA_SOURCES || PAID_SOURCES.has(tool);
}

/** The pill for a step; null when the tool is not a data source. */
export function pillFor(tool: string, data: unknown): SourcePill | null {
  if (tool in MANTUA_SOURCES)
    return { provider: "Mantua", category: MANTUA_SOURCES[tool] ?? "data" };
  if (tool === "search_paid_services") return { provider: "x402", category: "marketplace search" };
  if (tool === "call_paid_service") {
    const d = (data ?? {}) as { provider?: unknown; service?: unknown };
    const provider = typeof d.provider === "string" ? d.provider : "Paid service";
    return { provider, category: "paid data" };
  }
  return null;
}

/** "0.01 USDC" for a paid call that charged; "free" for Mantua's data; null while unknown. */
export function costLabel(tool: string, data: unknown): string | null {
  if (tool in MANTUA_SOURCES) return "free";
  if (tool !== "call_paid_service") return null;
  const d = (data ?? {}) as { usdCost?: unknown; available?: unknown };
  if (d.available === false) return "unavailable";
  if (typeof d.usdCost !== "number") return null;
  return d.usdCost === 0 ? "free" : `${d.usdCost.toFixed(2)} USDC`;
}
