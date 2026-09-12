/**
 * The league page's week windows (Sunday-to-Saturday) as `?dates=` ranges.
 * Pure, so the picker component only exports components.
 */
export interface WeekOption {
  label: string;
  /** YYYYMMDD-YYYYMMDD range for the slate API. */
  dates: string;
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${String(d.getFullYear())}${m}${day}`;
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
    const label =
      i === -1 ? "Last week" : i === 0 ? "This week" : `${shortDate(s)} – ${shortDate(e)}`;
    options.push({ label, dates: `${ymd(s)}-${ymd(e)}` });
  }
  return options;
}
