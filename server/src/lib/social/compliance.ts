/**
 * Task 070 / AE-006 — the compliance lint every post passes before it can
 * leave the server. Code, not the model: a template is data, the lint is
 * the rule.
 *
 *   forbidden_claim              guarantees, locks, risk-free, easy money
 *   missing_disclaimer           the fixed disclaimer must be present
 *   too_long                     over the platform limit
 *   unsubstantiated_performance  a sentence that talks about performance
 *                                may only carry figures the ledger produced
 *   directive_advice             an imperative to bet/buy/sell
 */

export const DISCLAIMER = "Not betting advice.";
export const MAX_POST_CHARS = 280;

/** Length in code points, the unit the platform limit is closest to. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

export type LintRule =
  | "forbidden_claim"
  | "missing_disclaimer"
  | "too_long"
  | "unsubstantiated_performance"
  | "directive_advice";

export interface LintViolation {
  rule: LintRule;
  detail: string;
}

export interface LintResult {
  ok: boolean;
  violations: LintViolation[];
}

export interface LintContext {
  /** Figures (as rendered) that came from the ledger and may appear in a
   *  performance sentence, e.g. "+$212.50", "40%", "14". */
  ledgerFigures: readonly string[];
}

const FORBIDDEN: readonly RegExp[] = [
  /guarantee/i,
  /can'?t lose/i,
  /cannot lose/i,
  /sure thing/i,
  /\ba lock\b/i,
  /risk[- ]free/i,
  /easy money/i,
  /free money/i,
  /no[- ]brainer/i,
  /100% (win|sure|certain)/i,
];

/** A sentence that is about performance rather than about a market. */
const PERFORMANCE =
  /\b(profit|profits|realised|realized|returns?|returned|roi|win rate|track record|p&l|pnl|drawdown|net)\b|\b(up|down)\s+[+-]?\$?\d/i;
const FIGURE = /[+-]?\$?\d[\d,]*(?:\.\d+)?%?/g;
const IMPERATIVES: ReadonlySet<string> = new Set([
  "bet",
  "buy",
  "sell",
  "back",
  "fade",
  "hammer",
  "load",
]);

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Lint one post text. */
export function lintPost(text: string, ctx: LintContext): LintResult {
  const violations: LintViolation[] = [];
  for (const re of FORBIDDEN) {
    const m = re.exec(text);
    if (m) violations.push({ rule: "forbidden_claim", detail: m[0] });
  }
  if (!text.includes(DISCLAIMER)) {
    violations.push({ rule: "missing_disclaimer", detail: `must include "${DISCLAIMER}"` });
  }
  const length = charCount(text);
  if (length > MAX_POST_CHARS) {
    violations.push({ rule: "too_long", detail: `${String(length)} > ${String(MAX_POST_CHARS)}` });
  }
  const allowed = new Set(ctx.ledgerFigures);
  for (const s of sentences(text)) {
    if (s === DISCLAIMER) continue;
    const first = s
      .split(/\s+/)[0]
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (IMPERATIVES.has(first)) violations.push({ rule: "directive_advice", detail: s });
    if (!PERFORMANCE.test(s)) continue;
    for (const figure of s.match(FIGURE) ?? []) {
      if (!allowed.has(figure)) {
        violations.push({ rule: "unsubstantiated_performance", detail: `${figure} in "${s}"` });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}
