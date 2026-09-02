/**
 * B9-004 — natural language → strategy draft.
 *
 * A DRAFT, not an armed strategy: parsing extracts thresholds, sizes, and a
 * team reference; the route resolves the team against real markets and the
 * user must confirm the structured preview before anything arms. Parsing is
 * deliberately conservative — a null here means "ask the user", never a
 * guessed number, because an armed strategy is standing authority to spend.
 */

export interface StrategyDraft {
  kind: "take-profit-stop" | "delta-hedge";
  /** Free-text team/market reference to resolve against the slate. */
  teamQuery?: string;
  takeProfitBps?: number;
  stopBps?: number;
  targetNetUsd?: number;
  bandUsd?: number;
  capUsd?: number;
}

const DEFAULT_CAP_USD = 100;

/** "80%" / "80 percent" → 8000 bps; null when absent or out of (0,100). */
function percentToBps(m: RegExpExecArray | null): number | null {
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return null;
  return Math.round(value * 100);
}

function dollars(re: RegExp, t: string): number | null {
  const m = re.exec(t);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Team text between a preposition and the trigger clause, e.g.
 *  "on the chiefs", "my chiefs position". Best-effort; empty is fine. */
function extractTeamQuery(t: string): string | undefined {
  const m =
    /\bmy\s+(?:the\s+)?([a-z][a-z .]{2,30}?)\s+(?:position|market|bet)/.exec(t) ??
    /\b(?:on|for)\s+(?:the\s+)?([a-z][a-z .]{2,30}?)(?:\s+(?:market|position|game|hits?|reach|crosses|drops?|falls?)|\s*$)/.exec(
      t,
    );
  const q = m?.[1]?.trim();
  return q && !["my", "a", "this", "that"].includes(q) ? q : undefined;
}

export function parseStrategyDraft(text: string): StrategyDraft | null {
  const t = text.toLowerCase().trim();

  // Delta hedge: "keep my exposure within $50", "hedge my exposure to $0 ± $25".
  if (/\b(hedge|exposure|delta)\b/.test(t) && /\bwithin|band|±|\+\/-\b/.test(t)) {
    const band = dollars(/(?:within|band(?:\s+of)?|±|\+\/-)\s*\$?\s*([\d,]+(?:\.\d+)?)/, t);
    const target = dollars(/(?:target|around|of net)\s*\$?\s*(-?[\d,]+(?:\.\d+)?)/, t) ?? 0;
    if (band === null) return null;
    return {
      kind: "delta-hedge",
      targetNetUsd: target,
      bandUsd: band,
      capUsd: dollars(/(?:cap|max)(?:\s+of)?\s*\$?\s*([\d,]+(?:\.\d+)?)/, t) ?? DEFAULT_CAP_USD,
    };
  }

  // Take-profit / stop. Both clauses may appear in one sentence.
  const tp = percentToBps(
    /(?:take[\s-]?profit|sell|close)[^.%]*?\b(?:at|hits?|reach(?:es)?|crosses|above)\s*([\d.]+)\s*(?:%|percent)/.exec(
      t,
    ),
  );
  const stop = percentToBps(
    /(?:stop(?:[\s-]?loss)?|cut)[^.%]*?\b(?:at|below|drops?\s+(?:to|below)|falls?\s+(?:to|below))\s*([\d.]+)\s*(?:%|percent)/.exec(
      t,
    ),
  );
  if (tp === null && stop === null) return null;
  if (tp !== null && stop !== null && stop >= tp) return null;

  const teamQuery = extractTeamQuery(t);
  return {
    kind: "take-profit-stop",
    ...(teamQuery !== undefined ? { teamQuery } : {}),
    ...(tp !== null ? { takeProfitBps: tp } : {}),
    ...(stop !== null ? { stopBps: stop } : {}),
    capUsd: dollars(/(?:cap|max)(?:\s+of)?\s*\$?\s*([\d,]+(?:\.\d+)?)/, t) ?? DEFAULT_CAP_USD,
  };
}

/** Human-readable preview lines for the confirmation card (B9-004). */
export function previewLines(draft: StrategyDraft): string[] {
  const lines: string[] = [];
  if (draft.kind === "take-profit-stop") {
    lines.push("Type: take-profit / stop on one market position");
    if (draft.teamQuery) lines.push(`Market: "${draft.teamQuery}" (to be confirmed)`);
    if (draft.takeProfitBps !== undefined) {
      lines.push(
        `Close at profit: implied probability ≥ ${(draft.takeProfitBps / 100).toFixed(0)}%`,
      );
    }
    if (draft.stopBps !== undefined) {
      lines.push(`Stop: implied probability ≤ ${(draft.stopBps / 100).toFixed(0)}%`);
    }
  } else {
    lines.push("Type: delta hedge across correlated markets");
    lines.push(`Target net exposure: $${String(draft.targetNetUsd ?? 0)}`);
    lines.push(`Band: ±$${String(draft.bandUsd ?? 0)}`);
  }
  lines.push(`Spend cap: $${String(draft.capUsd ?? DEFAULT_CAP_USD)} USDC`);
  lines.push(
    "Auto-disarms at kickoff freeze, resolution, or expiry. Nothing arms until you confirm.",
  );
  return lines;
}
