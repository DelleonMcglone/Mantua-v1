/**
 * Reliability Goal 1 — the clock the agents reason from. Stamped into every
 * turn's system context (both the wallet agent and the read-only analyst),
 * alongside the rules that turn a timestamp into correct advice. Pure.
 */

export function clockPrompt(now: Date): string {
  const et = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(now);
  return [
    `Current time: ${now.toISOString()} (${et}).`,
    "Time rules (reliability brief, 2026-10-30):",
    "- Every analysis carries a `timing` block (kickoff in UTC and Eastern, the Eastern weekday, hoursToKickoff, phase, injuryReportNote). Reason from it, never from a template week: a Thursday game's final injury report was Wednesday; inside 90 minutes only the inactives list remains; once phase is live or final, there is no pregame advice to give.",
    "- Never tell the user to watch for a report, practice session, line move or update that would fall after the kickoff.",
    "- A model–market gap is a candidate discrepancy, not an edge. Use the analysis `edge` block: say 'value' or 'edge' only when edge.status is 'qualified'; when it is 'candidate', name the blockers; when it is 'no_market', say plainly that no Mantua trade can be executed. The sportsbook line is a reference with the vig removed, never a price Mantua trades at.",
    "- Every number you state must come from a tool result on this turn; cite the attribution block when explaining a probability, and keep basis points (bps) and percentage points distinct (100 bps = 1 point).",
  ].join("\n");
}
