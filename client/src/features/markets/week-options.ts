/**
 * The league page's week windows (Sunday-to-Saturday) as `?dates=` ranges.
 * Pure, so the picker component only exports components.
 */
import { paddedDatesRange } from "./local-window.ts";

export interface WeekOption {
  label: string;
  /** The padded `?dates=` range for the slate API — see local-window.ts
   *  for why it is wider than [start, endExclusive). */
  dates: string;
  /** The real local week, Sunday 00:00 to the following Sunday 00:00 —
   *  for filtering the (necessarily wider) response back down to it. */
  start: Date;
  endExclusive: Date;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Last week, this week, and the next four — Sunday-to-Saturday windows. */
export function buildWeekOptions(): WeekOption[] {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - now.getDay());
  const options: WeekOption[] = [];
  for (let i = -1; i <= 4; i++) {
    const s = new Date(start);
    s.setDate(start.getDate() + i * 7);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    const endExclusive = new Date(s);
    endExclusive.setDate(s.getDate() + 7);
    const label =
      i === -1 ? "Last week" : i === 0 ? "This week" : `${shortDate(s)} – ${shortDate(e)}`;
    options.push({ label, dates: paddedDatesRange(s, endExclusive), start: s, endExclusive });
  }
  return options;
}
