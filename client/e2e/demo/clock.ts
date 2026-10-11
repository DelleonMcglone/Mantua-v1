/**
 * The demo's clock: everything is shown as a US-East viewer sees it on
 * Sunday 2026-10-11. The recorded browser's clock is pinned to a moment
 * inside the snapshot's own timeline, so the board filters to that day
 * whenever the recording is made, and "Updated just now" stays true.
 */
import type { DemoEvent } from "./snapshot.ts";

export const DEMO_DAY = "20261011";
const DEMO_DAY_ISO = "2026-10-11";
const TZ = "America/New_York";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
});

/** Epoch seconds → "YYYY-MM-DD" in Eastern time. */
export const etDay = (seconds: number): string => dayFmt.format(new Date(seconds * 1000));
/** Epoch seconds → "4:25 PM" in Eastern time. */
export const etTime = (seconds: number): string => timeFmt.format(new Date(seconds * 1000));

/** The games on the demo day, earliest first. */
export function sundayEvents(events: readonly DemoEvent[]): DemoEvent[] {
  return events
    .filter((e) => etDay(e.startsAt) === DEMO_DAY_ISO)
    .sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * The moment the browser's clock is pinned to: inside the latest game in
 * progress; shortly after the last final when nothing is live; ninety
 * minutes before the first kickoff when nothing has started.
 */
export function demoNowMs(events: readonly DemoEvent[]): number {
  const today = sundayEvents(events);
  const live = today.filter((e) => e.status === "in_progress");
  if (live.length > 0) return (Math.max(...live.map((e) => e.startsAt)) + 40 * 60) * 1000;
  const finals = today.filter((e) => e.status === "final");
  const upcoming = today.filter((e) => e.status === "scheduled");
  if (finals.length > 0) {
    const afterFinal = Math.max(...finals.map((e) => e.startsAt)) + 3 * 3600 + 20 * 60;
    const beforeNext =
      upcoming.length > 0 ? Math.min(...upcoming.map((e) => e.startsAt)) - 60 : afterFinal;
    return Math.min(afterFinal, beforeNext) * 1000;
  }
  if (upcoming.length > 0) return (Math.min(...upcoming.map((e) => e.startsAt)) - 90 * 60) * 1000;
  return Date.parse(`${DEMO_DAY_ISO}T15:30:00Z`);
}
