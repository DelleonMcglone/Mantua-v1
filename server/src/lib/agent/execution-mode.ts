/**
 * Task 070 / AE-013 — the mode a ledger entry was executed under, derived
 * from the audit row written at execution time.
 *
 * The public performance ledger must say, for every trade, whether the
 * user pressed confirm, an engine acted under a pre-armed policy, or
 * nothing at all is recorded. Nothing here guesses: a fill with no audit
 * row, or an audit row that carries neither a confirmation id nor the
 * autonomous mode flag, is `unattributed` and is still counted — the
 * label is honest, the trade is never hidden.
 */

export const LEDGER_MODES = ["simulated", "user_confirmed", "autonomous", "unattributed"] as const;
export type LedgerMode = (typeof LEDGER_MODES)[number];

/** The slice of a `mantua_audit_log` row the mapping reads. */
export interface AuditAttribution {
  action: string;
  params: Record<string, unknown>;
}

const ENGINE_ACTIONS: ReadonlySet<string> = new Set(["strategy_execute", "strategy_close"]);

function confirmationIdIn(params: Record<string, unknown>): boolean {
  const args = params["args"];
  if (!args || typeof args !== "object") return false;
  const id = (args as Record<string, unknown>)["confirmationId"];
  return typeof id === "string" && id.length > 0;
}

/** Map one audit row (or its absence) to the ledger mode. */
export function executionModeOf(audit: AuditAttribution | undefined): LedgerMode {
  if (!audit) return "unattributed";
  if (ENGINE_ACTIONS.has(audit.action)) return "autonomous";
  if (audit.action !== "agent_market_trade") return "unattributed";
  if (confirmationIdIn(audit.params)) return "user_confirmed";
  if (audit.params["mode"] === "autonomous") return "autonomous";
  return "unattributed";
}
