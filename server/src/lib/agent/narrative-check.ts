/**
 * Reliability Goal 7 (owner brief, 2026-10-30) — the narrative must match
 * the evidence. After a turn's prose is complete, this check reads every
 * figure and calendar claim in it against the tool results of that same
 * turn and reports what it could not match. Pure; the generators decide
 * what to do with the result (today: a visible caveat line, a counter and
 * a log line — never a silent pass).
 *
 * Three kinds of violation:
 *   unsupported_figure — a percentage or bps figure no tool result on this
 *                        turn produced (allowing display rounding);
 *   edge_claim         — "value" / "edge" / "mispriced" language while no
 *                        analysis on the turn has edge.status "qualified";
 *   future_weekday     — a weekday named with report/update language that
 *                        falls after a pregame kickoff on the turn.
 */

export type ViolationKind = "unsupported_figure" | "edge_claim" | "future_weekday";

export interface NarrativeViolation {
  kind: ViolationKind;
  excerpt: string;
  detail: string;
}

export interface NarrativeCheck {
  ok: boolean;
  figuresChecked: number;
  violations: NarrativeViolation[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_RE =
  /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g;
const REPORT_WORDS =
  /\b(update|updates|report|reports|practice|designation|designations|inactives?|news|downgrade|downgrades)\b/i;
const EDGE_WORDS = /\b(value|edge|mispriced|\+EV|positive expected value)\b/i;
const EDGE_DISCLAIMED =
  /\b(candidate discrepancy|not (a |an )?(validated |true |real )?(edge|value)|no (validated )?(edge|value)|cannot (be )?(call|called) (this |it )?value|do not call this value)\b/i;

function easternWeekday(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(d);
}

/** Every finite number in a tool result, with bps-keyed values noted. */
export function collectNumbers(data: unknown, bps: Set<number>, all: Set<number>, key = ""): void {
  if (typeof data === "number" && Number.isFinite(data)) {
    all.add(data);
    if (/bps$/i.test(key)) bps.add(data);
    return;
  }
  if (Array.isArray(data)) {
    for (const v of data) collectNumbers(v, bps, all, key);
    return;
  }
  if (typeof data === "object" && data !== null) {
    for (const [k, v] of Object.entries(data)) collectNumbers(v, bps, all, k);
  }
}

function percentSupported(x: number, bps: Set<number>, all: Set<number>): boolean {
  for (const b of bps) {
    const p = b / 100;
    if (Math.abs(p - x) <= 0.051 || Math.round(p) === x) return true;
  }
  for (const n of all) if (Math.abs(n - x) <= 0.051) return true;
  return false;
}

function bpsSupported(x: number, bps: Set<number>): boolean {
  if (bps.has(x)) return true;
  const vals = [...bps];
  for (const a of vals) for (const b of vals) if (Math.abs(a - b) === x) return true;
  return false;
}

interface Timing {
  phase?: unknown;
  weekdayEastern?: unknown;
}
function timings(toolData: readonly unknown[]): Timing[] {
  const out: Timing[] = [];
  for (const d of toolData) {
    const t = (d as { timing?: Timing } | null)?.timing;
    if (t && typeof t === "object") out.push(t);
  }
  return out;
}

function hasQualifiedEdge(toolData: readonly unknown[]): boolean {
  return toolData.some(
    (d) => (d as { edge?: { status?: unknown } } | null)?.edge?.status === "qualified",
  );
}

/** Weekdays from `now` through the kickoff weekday, inclusive, forward. */
export function allowedWeekdays(nowWeekday: string, kickoffWeekday: string): Set<string> {
  const a = WEEKDAYS.indexOf(nowWeekday);
  const b = WEEKDAYS.indexOf(kickoffWeekday);
  const out = new Set<string>();
  if (a < 0 || b < 0) return out;
  for (let i = a; ; i = (i + 1) % 7) {
    out.add(WEEKDAYS[i]);
    if (i === b) break;
  }
  return out;
}

export function checkNarrative(
  text: string,
  toolData: readonly unknown[],
  now: Date,
): NarrativeCheck {
  const bps = new Set<number>();
  const all = new Set<number>();
  for (const d of toolData) collectNumbers(d, bps, all);
  const violations: NarrativeViolation[] = [];
  let figuresChecked = 0;

  for (const m of text.matchAll(/(\d{1,3}(?:\.\d)?)\s?%/g)) {
    figuresChecked += 1;
    const x = Number(m[1]);
    if (!percentSupported(x, bps, all))
      violations.push({
        kind: "unsupported_figure",
        excerpt: m[0],
        detail: "no tool result on this turn produced this percentage",
      });
  }
  for (const m of text.matchAll(/(\d{2,5})\s?bps\b/gi)) {
    figuresChecked += 1;
    const x = Number(m[1]);
    if (!bpsSupported(x, bps))
      violations.push({
        kind: "unsupported_figure",
        excerpt: m[0],
        detail: "no tool result or gap between results on this turn equals this bps figure",
      });
  }

  if (EDGE_WORDS.test(text) && !hasQualifiedEdge(toolData) && !EDGE_DISCLAIMED.test(text)) {
    const m = EDGE_WORDS.exec(text);
    violations.push({
      kind: "edge_claim",
      excerpt: m?.[0] ?? "value",
      detail:
        "no analysis on this turn has edge.status 'qualified'; a gap is a candidate discrepancy only",
    });
  }

  const pregame = timings(toolData).filter(
    (t) => t.phase === "pregame" && typeof t.weekdayEastern === "string",
  );
  if (pregame.length > 0) {
    const allowed = new Set<string>();
    for (const t of pregame)
      for (const w of allowedWeekdays(easternWeekday(now), t.weekdayEastern as string))
        allowed.add(w);
    for (const m of text.matchAll(WEEKDAY_RE)) {
      const day = m[1].slice(0, 3);
      const idx = m.index;
      const window = text.slice(Math.max(0, idx - 60), idx + 60);
      if (!allowed.has(day) && REPORT_WORDS.test(window)) {
        violations.push({
          kind: "future_weekday",
          excerpt: m[0],
          detail: `falls after the kickoff on this turn (allowed: ${[...allowed].join(", ")})`,
        });
      }
    }
  }

  return { ok: violations.length === 0, figuresChecked, violations };
}

/** The one visible line appended to a turn that failed the check. */
export function caveatLine(check: NarrativeCheck): string {
  const items = check.violations.map((v) =>
    v.kind === "unsupported_figure"
      ? `${v.excerpt} (not in this turn's data)`
      : v.kind === "edge_claim"
        ? `"${v.excerpt}" (no qualified edge on this turn)`
        : `${v.excerpt} (after kickoff)`,
  );
  return `\n\n_Checked against this turn's data: ${String(items.length)} claim${items.length === 1 ? "" : "s"} could not be verified — ${items.join("; ")}._`;
}
