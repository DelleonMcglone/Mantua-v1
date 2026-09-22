import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWithinLocalWindow, localDayWindow, paddedDatesRange } from "./local-window.ts";

/** Server-side semantics, mirrored: `dates=A-B` covers [A 00:00 UTC, B 00:00 UTC + 1 day). */
function serverRangeMs(dates: string): { fromMs: number; toMs: number } {
  const [a, b] = dates.split("-");
  const parse = (ymd: string) =>
    Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`);
  return { fromMs: parse(a), toMs: parse(b) + 86_400_000 };
}

/**
 * `localDayWindow` computes local midnight from the RUNNER's system clock —
 * a JS `Date` carries no timezone identity of its own — so every viewer
 * scenario below pins `TZ` explicitly rather than trusting whatever zone
 * CI happens to default to, and restores it afterwards so it can't leak to
 * a sibling test file sharing this process.
 */
function withTz<T>(tz: string, run: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = original;
  }
}

void describe("local-window: the reproduced production bug (a US Eastern viewer)", () => {
  void it("Monday Night Football at 8:15pm EDT is inside 'today'", () => {
    withTz("America/New_York", () => {
      // 2026-09-21, 9:23pm local — the exact moment this was reported live.
      const reference = new Date(2026, 8, 21, 21, 23, 17);
      const { start, endExclusive } = localDayWindow(reference);
      const mnfKickoff = Math.floor(new Date(2026, 8, 21, 20, 15).getTime() / 1000);

      // The OLD, buggy behaviour this replaces: send the bare local ymd
      // as-is. That shipped as dates=20260921-20260921 — a naive UTC
      // "today" window the kickoff falls just outside of.
      const oldRange = serverRangeMs("20260921-20260921");
      assert.ok(
        mnfKickoff * 1000 >= oldRange.toMs,
        "sanity check: MNF kickoff really does fall outside the naive UTC 'today' window",
      );

      // The fix: the padded request is a superset that contains it...
      const dates = paddedDatesRange(start, endExclusive);
      const { fromMs, toMs } = serverRangeMs(dates);
      assert.ok(mnfKickoff * 1000 >= fromMs && mnfKickoff * 1000 < toMs, dates);

      // ...and the local-window filter keeps it.
      assert.equal(isWithinLocalWindow(mnfKickoff, start, endExclusive), true);
    });
  });

  void it("drops last night's late game that the padded request also returns", () => {
    withTz("America/New_York", () => {
      const reference = new Date(2026, 8, 21, 21, 23, 17);
      const { start, endExclusive } = localDayWindow(reference);
      // Sunday Night Football, the previous evening — still inside the
      // naive UTC 'today' window, and still inside the padded request,
      // but not actually today.
      const snfKickoff = Math.floor(new Date(2026, 8, 20, 20, 20).getTime() / 1000);
      assert.equal(isWithinLocalWindow(snfKickoff, start, endExclusive), false);
    });
  });

  void it("keeps an early-afternoon game on the same local day", () => {
    withTz("America/New_York", () => {
      const reference = new Date(2026, 8, 21, 21, 23, 17);
      const { start, endExclusive } = localDayWindow(reference);
      const afternoonKickoff = Math.floor(new Date(2026, 8, 21, 13, 0).getTime() / 1000);
      assert.equal(isWithinLocalWindow(afternoonKickoff, start, endExclusive), true);
    });
  });

  void it("localDayWindow spans exactly local midnight to local midnight", () => {
    withTz("America/New_York", () => {
      const reference = new Date(2026, 8, 21, 15, 42);
      const { start, endExclusive } = localDayWindow(reference);
      assert.equal(start.getHours(), 0);
      assert.equal(start.getDate(), 21);
      assert.equal(endExclusive.getDate(), 22);
      assert.equal(endExclusive.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
    });
  });
});

void describe("local-window: padding covers the extremes of the clock", () => {
  void it("is a superset of the local day for a far-west viewer (UTC-12)", () => {
    withTz("Etc/GMT+12", () => {
      const reference = new Date(2026, 8, 21, 23, 0);
      const { start, endExclusive } = localDayWindow(reference);
      const dates = paddedDatesRange(start, endExclusive);
      const { fromMs, toMs } = serverRangeMs(dates);
      assert.ok(fromMs <= start.getTime());
      assert.ok(toMs >= endExclusive.getTime());
    });
  });

  void it("is a superset of the local day for a far-east viewer (UTC+14)", () => {
    withTz("Pacific/Kiritimati", () => {
      const reference = new Date(2026, 8, 21, 1, 0);
      const { start, endExclusive } = localDayWindow(reference);
      const dates = paddedDatesRange(start, endExclusive);
      const { fromMs, toMs } = serverRangeMs(dates);
      assert.ok(fromMs <= start.getTime());
      assert.ok(toMs >= endExclusive.getTime());
    });
  });
});

void describe("local-window: multi-day (week) windows", () => {
  // Built from explicit local-component Dates, so this suite needs no
  // withTz: construction and the module's own reads share the same basis
  // whatever TZ is active.
  void it("pads the same way at both ends and keeps a Saturday-night boundary game", () => {
    const start = new Date(2026, 8, 20, 0, 0, 0, 0); // Sunday
    const endExclusive = new Date(2026, 8, 27, 0, 0, 0, 0); // next Sunday
    const dates = paddedDatesRange(start, endExclusive);
    assert.equal(dates, "20260919-20260927");
    const { fromMs, toMs } = serverRangeMs(dates);
    assert.ok(fromMs <= start.getTime());
    assert.ok(toMs >= endExclusive.getTime());
    // The boundary case this exists for: a Saturday-night game (the last
    // real day, one before endExclusive) stays inside the filter.
    const saturdayNight = Math.floor(new Date(2026, 8, 26, 23, 30).getTime() / 1000);
    assert.equal(isWithinLocalWindow(saturdayNight, start, endExclusive), true);
  });
});
