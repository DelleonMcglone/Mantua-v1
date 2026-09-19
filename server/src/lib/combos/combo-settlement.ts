/**
 * Task 072 / CB-007 — the conjunction rule. A combo market resolves from
 * its legs' on-chain resolutions and nothing else: any leg lost → lost
 * (settled early, the moment the resolver may freeze it); every non-void
 * leg won → won; every leg void → void; a void leg drops out and the
 * remaining legs decide. Pure: the cron feeds it rows, it returns actions.
 */

export const LEG_RESULTS = ["pending", "won", "lost", "void"] as const;
export type LegResult = (typeof LEG_RESULTS)[number];

/** Market.State names as `markets.state` stores them. */
const DECIDED_STATES = new Set(["RESOLVED", "SETTLED"]);

/**
 * A leg market's row → the leg's result. `winningOutcomeIndex` is the
 * resolutions log's value: 0 = YES pays, 1 = NO pays. A RESOLVED market
 * whose winner is not on record stays `pending` — never guessed.
 */
export function legResultFrom(marketState: string, winningOutcomeIndex: number | null): LegResult {
  if (marketState === "INVALID") return "void";
  if (!DECIDED_STATES.has(marketState)) return "pending";
  if (winningOutcomeIndex === 0) return "won";
  if (winningOutcomeIndex === 1) return "lost";
  return "pending";
}

export interface ComboVerdict {
  kind: "pending" | "won" | "lost" | "void";
  won: number;
  lost: number;
  void: number;
  pending: number;
}

export function comboOutcome(results: readonly LegResult[]): ComboVerdict {
  const count = { won: 0, lost: 0, void: 0, pending: 0 };
  for (const r of results) count[r] += 1;
  let kind: ComboVerdict["kind"] = "pending";
  if (count.lost > 0) kind = "lost";
  else if (count.pending === 0 && count.won > 0) kind = "won";
  else if (count.pending === 0 && count.void === results.length && results.length > 0)
    kind = "void";
  return { kind, ...count };
}

export interface SettleableCombo {
  comboMarketId: `0x${string}`;
  /** Unix seconds — the combo market's on-chain `startsAt` (latest kickoff). */
  startsAt: number;
  /** The combo market's own state. */
  marketState: string;
  legResults: readonly LegResult[];
}

export interface ComboResolutionAction {
  comboMarketId: `0x${string}`;
  kind: "freeze" | "resolve" | "void";
  /** For resolves: 0 = YES (won), 1 = NO (lost). */
  outcome?: 0 | 1;
  verdict: ComboVerdict;
}

/** The kickoff-before-freeze rule of `Market.freeze` for the resolver. */
export function comboFreezable(
  combo: Pick<SettleableCombo, "startsAt">,
  nowSeconds: number,
): boolean {
  return nowSeconds >= combo.startsAt;
}

/**
 * Actions for one pass, in submission order: a decided combo still OPEN is
 * frozen (once its startsAt has passed — the contract's rule for the
 * resolver) and then resolved or voided; a FROZEN one is resolved or
 * voided; an undecided or already-resolved one yields nothing.
 */
export function planComboResolution(
  combos: readonly SettleableCombo[],
  nowSeconds: number,
): ComboResolutionAction[] {
  const out: ComboResolutionAction[] = [];
  for (const c of combos) {
    const verdict = comboOutcome(c.legResults);
    if (verdict.kind === "pending") continue;
    if (c.marketState !== "OPEN" && c.marketState !== "FROZEN") continue;
    if (verdict.kind === "void") {
      out.push({ comboMarketId: c.comboMarketId, kind: "void", verdict });
      continue;
    }
    if (!comboFreezable(c, nowSeconds)) continue;
    if (c.marketState === "OPEN") {
      out.push({ comboMarketId: c.comboMarketId, kind: "freeze", verdict });
    }
    out.push({
      comboMarketId: c.comboMarketId,
      kind: "resolve",
      outcome: verdict.kind === "won" ? 0 : 1,
      verdict,
    });
  }
  return out;
}

/** The ticket status a verdict maps to once the market has settled. */
export function ticketStatusFor(verdict: ComboVerdict): "won" | "lost" | "void" | null {
  return verdict.kind === "pending" ? null : verdict.kind;
}
