/**
 * Task 067 — the drill's rules: only the kill switch's own refusal counts
 * as engaged, every §13 expectation is judged, and the log names each miss.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRILL_LIMIT_MS, classifyWrite, judge, renderLog, type DrillRecord } from "./drill-core.ts";

const T = Date.UTC(2026, 8, 13, 12, 0, 0);

function passing(): DrillRecord {
  return {
    host: "https://staging.example",
    commit: "d67152d",
    operator: "op",
    observer: "obs",
    t0: T,
    t1: T + 10_000,
    t2: T + 22_000,
    t3: T + 23_000,
    clientPaused: true,
    cron503: true,
    t6: T + 60_000,
    t7: T + 68_000,
    clientResumed: true,
  };
}

void describe("classifyWrite", () => {
  void it("only KILL_SWITCH_ACTIVE means engaged; other 503s are unknown; 400 means open", () => {
    const base = { at: T, status: null };
    assert.equal(
      classifyWrite({ ...base, writeCode: 503, writeErrorCode: "KILL_SWITCH_ACTIVE" }),
      "engaged",
    );
    assert.equal(
      classifyWrite({ ...base, writeCode: 503, writeErrorCode: "TRADING_HALTED" }),
      "unknown",
    );
    assert.equal(classifyWrite({ ...base, writeCode: 400, writeErrorCode: "BAD_REQUEST" }), "open");
    assert.equal(classifyWrite({ ...base, writeCode: 401, writeErrorCode: null }), "open");
    assert.equal(classifyWrite({ ...base, writeCode: null, writeErrorCode: null }), "unknown");
  });
});

void describe("judge", () => {
  void it("passes a clean drill", () => {
    assert.deepEqual(judge(passing()), { pass: true, reasons: [] });
  });

  void it("fails on a slow engage and names the time", () => {
    const r = { ...passing(), t2: T + 10_000 + DRILL_LIMIT_MS + 500 };
    const v = judge(r);
    assert.equal(v.pass, false);
    assert.match(v.reasons[0] ?? "", /engage took 20\.5 s/);
  });

  void it("fails when the client never paused, a cron ran, or release never came", () => {
    const v = judge({ ...passing(), clientPaused: false, cron503: false, t7: null });
    assert.deepEqual(v.reasons, [
      "client did not pause without a reload",
      "a money cron ran while engaged",
      "write path never reopened after release",
    ]);
  });
});

void describe("renderLog", () => {
  void it("renders the §13 template with deltas and the verdict", () => {
    const log = renderLog(passing());
    assert.match(
      log,
      /^Date \/ host \/ commit: 2026-09-13 \/ https:\/\/staging.example \/ d67152d/,
    );
    assert.match(log, /T2−T1 = 12\.0 s/);
    assert.match(log, /T7−T6 = 8\.0 s/);
    assert.match(log, /Result: PASS$/);
  });

  void it("spells out every failure reason", () => {
    const log = renderLog({ ...passing(), clientResumed: null, t1: null, t2: null });
    assert.match(log, /Step 8 client resumed \(no reload\): not observed/);
    assert.match(
      log,
      /Result: FAIL — write path never refused after engage; client did not resume/,
    );
  });
});
