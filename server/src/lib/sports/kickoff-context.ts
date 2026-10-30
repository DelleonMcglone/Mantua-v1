/**
 * Reliability Goal 1 (owner brief, 2026-10-30) — temporal correctness.
 *
 * The agent wrote "watch Friday/Saturday injury updates" for a Thursday
 * night game because nothing told it what day it was or how far away the
 * kickoff stood. This block is attached to every analysis and the current
 * time is stamped into every turn, so time-sensitive advice is judged
 * against the kickoff, in the game's local calendar, not against a
 * template week.
 *
 * Pure. Times compare in UTC; the user-facing strings are Eastern (the
 * NFL's scheduling clock) with the zone and calendar date spelled out.
 */

export type GamePhase = "pregame" | "live" | "final" | "postponed";

export interface KickoffContext {
  kickoffUtc: string;
  /** e.g. "Thu 2026-10-29 20:15 EDT" — the calendar the NFL schedule uses. */
  kickoffEastern: string;
  weekdayEastern: string;
  nowUtc: string;
  /** Hours from `now` to kickoff, one decimal; negative once it has passed. */
  hoursToKickoff: number;
  phase: GamePhase;
  /** What injury news can still arrive before this kickoff, given the day. */
  injuryReportNote: string;
  /** The one rule the narrative must obey. */
  rule: string;
}

const ET = "America/New_York";

function easternParts(d: Date): { weekday: string; date: string; time: string; zone: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`,
    zone: get("timeZoneName"),
  };
}

export function phaseOf(status: string, hoursToKickoff: number): GamePhase {
  const s = status.toLowerCase();
  if (s === "final" || s === "closed") return "final";
  if (s === "postponed" || s === "cancelled" || s === "canceled") return "postponed";
  if (s === "in_progress" || s === "live" || s === "halftime") return "live";
  return hoursToKickoff <= 0 ? "live" : "pregame";
}

/** The NFL injury-report calendar, by the game's Eastern weekday. */
export function injuryReportNote(
  weekday: string,
  hoursToKickoff: number,
  phase: GamePhase,
): string {
  if (phase !== "pregame") return "The game has started or ended: injury reports no longer apply.";
  if (hoursToKickoff <= 1.5)
    return "Inside 90 minutes of kickoff: the inactives list is out or due; no further injury report is coming.";
  switch (weekday) {
    case "Thu":
      return "Thursday game: the final injury report was Wednesday. The only news left before kickoff is the inactives list, 90 minutes before.";
    case "Mon":
      return "Monday game: the final injury report lands Saturday; Sunday brings downgrades; inactives 90 minutes before kickoff.";
    case "Sat":
      return "Saturday game: the final injury report lands Thursday or Friday; inactives 90 minutes before kickoff.";
    default:
      return "Sunday game: practice reports Wednesday–Friday, final designations Friday, Saturday downgrades, inactives 90 minutes before kickoff.";
  }
}

export function kickoffContext(startsAt: Date, now: Date, status: string): KickoffContext {
  const hoursToKickoff = Math.round(((startsAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10;
  const phase = phaseOf(status, hoursToKickoff);
  const k = easternParts(startsAt);
  return {
    kickoffUtc: startsAt.toISOString(),
    kickoffEastern: `${k.weekday} ${k.date} ${k.time} ${k.zone}`,
    weekdayEastern: k.weekday,
    nowUtc: now.toISOString(),
    hoursToKickoff,
    phase,
    injuryReportNote: injuryReportNote(k.weekday, hoursToKickoff, phase),
    rule: "Never cite a report, practice session, line move or update that would fall after this kickoff; judge every 'watch for' against hoursToKickoff and the Eastern weekday above.",
  };
}
