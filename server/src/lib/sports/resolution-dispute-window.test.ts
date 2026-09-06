/**
 * Task 044 (D-104) — the dispute window between the criteria gate and the
 * on-chain submit, exercised at the `executeResolution` seam with the
 * `DisputeWindowGate` port faked (the DB-backed gate is
 * `drizzleDisputeWindow`; its SQL is a thin guarded UPDATE).
 *
 * The legs, each its own test:
 *  - first pass that clears the gate OPENS the window: no submit, no log
 *    ink, an `opened` event;
 *  - a later pass inside the window parks (`awaiting`): no submit, no ink;
 *  - an operator hold parks even an elapsed window (`held`);
 *  - an elapsed, unheld, still-VERIFIED outcome submits, with the window
 *    stamped onto the log record and an `elapsed` event;
 *  - a DISPUTED confidence state refuses at the gate itself — the window
 *    never even gets consulted (`confidence_verified` rejection);
 *  - a zero window (tests/dev) opens-and-submits in one pass;
 *  - voids are window-exempt (B4-005);
 *  - no gate configured → legacy immediate-submit behaviour.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  executeResolution,
  planResolution,
  type DisputeWindowEvent,
  type DisputeWindowGate,
  type DisputeWindowState,
  type ResolutionRecord,
  type ResolutionSubmitter,
} from "./resolution.ts";
import type { ProviderEvent, ProviderSlate } from "./provider.ts";

const NOW = 1_800_000_000;
const WINDOW = 900;

function event(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    providerEventId: "401671789",
    league: "nfl",
    startsAt: NOW - 4 * 3600,
    status: "final",
    home: { providerId: "1", key: "nfl:KC", name: "KC Team", abbreviation: "KC" },
    away: { providerId: "2", key: "nfl:LV", name: "LV Team", abbreviation: "LV" },
    homeScore: 27,
    awayScore: 20,
    ...overrides,
  };
}

function slate(events: ProviderEvent[], fetchedAtMs = NOW * 1000): ProviderSlate {
  return { provider: "espn", league: "nfl", events, delayed: false, fetchedAt: fetchedAtMs };
}

function fakeSubmitter() {
  const calls: string[] = [];
  const submitter: ResolutionSubmitter = {
    signerAddress: () => "0xSIGNER",
    freeze: () => {
      calls.push("freeze");
      return Promise.resolve(null);
    },
    resolve: (auth) => {
      calls.push(`resolve:${String(auth.outcome)}`);
      return Promise.resolve(`0xtx-${String(calls.length)}`);
    },
    void: () => {
      calls.push("void");
      return Promise.resolve(`0xtx-${String(calls.length)}`);
    },
  };
  return { submitter, calls };
}

function fakeLog() {
  const records: ResolutionRecord[] = [];
  return { records, log: { record: (r: ResolutionRecord) => (records.push(r), Promise.resolve()) } };
}

/** In-memory gate mirroring drizzleDisputeWindow's contract: `open` is
 *  idempotent and immediately visible to `stateFor`. */
function fakeGate(windowSeconds: number, preloaded: Map<string, DisputeWindowState> = new Map()) {
  const states = new Map(preloaded);
  const opened: string[] = [];
  const gate: DisputeWindowGate = {
    windowSeconds,
    stateFor: (id) => states.get(id) ?? null,
    open(id, opensAt, closesAt) {
      opened.push(id);
      if (!states.has(id)) states.set(id, { opensAt, closesAt, heldAt: null, holdNote: null });
      return Promise.resolve();
    },
  };
  return { gate, opened, states };
}

function collectEvents() {
  const events: DisputeWindowEvent[] = [];
  return { events, onWindowEvent: (e: DisputeWindowEvent) => void events.push(e) };
}

void describe("executeResolution — D-104 dispute window", () => {
  void it("first pass that clears the gate opens the window: no submit, no ink", async () => {
    const plan = planResolution(slate([event()]), null, NOW);
    const { submitter, calls } = fakeSubmitter();
    const { records, log } = fakeLog();
    const { gate, opened } = fakeGate(WINDOW);
    const { events: seen, onWindowEvent } = collectEvents();

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      disputeWindow: gate,
      onWindowEvent,
    });

    // One window per game outcome, even with two markets in the pair.
    assert.equal(opened.length, 1);
    assert.equal(summary.windowsOpened, 1);
    // The pair's second market finds the just-opened window still pending.
    assert.equal(summary.awaitingWindow, 1);
    assert.equal(summary.resolved, 0);
    assert.equal(summary.rejected.length, 0);
    assert.equal(records.length, 0, "no log ink before the window elapses");
    assert.ok(!calls.some((c) => c.startsWith("resolve")), "nothing submitted on-chain");
    assert.equal(seen.filter((e) => e.kind === "opened").length, 1);
    const openedEvt = seen.find((e) => e.kind === "opened");
    assert.ok(openedEvt);
    assert.equal(
      openedEvt.closesAt.getTime() - openedEvt.opensAt.getTime(),
      WINDOW * 1000,
    );
  });

  void it("a pass inside the window parks: no submit, no ink", async () => {
    const opensAt = new Date((NOW - 300) * 1000);
    const closesAt = new Date((NOW - 300 + WINDOW) * 1000);
    const preloaded = new Map<string, DisputeWindowState>([
      ["401671789", { opensAt, closesAt, heldAt: null, holdNote: null }],
    ]);
    const plan = planResolution(slate([event()]), null, NOW);
    const { submitter, calls } = fakeSubmitter();
    const { records, log } = fakeLog();
    const { gate, opened } = fakeGate(WINDOW, preloaded);

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      disputeWindow: gate,
    });

    assert.equal(opened.length, 0, "an open window is never re-opened");
    assert.equal(summary.windowsOpened, 0);
    assert.equal(summary.awaitingWindow, 2, "both pair markets wait");
    assert.equal(summary.resolved, 0);
    assert.equal(records.length, 0);
    assert.ok(!calls.some((c) => c.startsWith("resolve")));
  });

  void it("an operator hold parks the outcome even after the window elapsed", async () => {
    const opensAt = new Date((NOW - 2 * WINDOW) * 1000);
    const closesAt = new Date((NOW - WINDOW) * 1000); // long elapsed
    const preloaded = new Map<string, DisputeWindowState>([
      [
        "401671789",
        { opensAt, closesAt, heldAt: new Date((NOW - 60) * 1000), holdNote: "suspicious final" },
      ],
    ]);
    const plan = planResolution(slate([event()]), null, NOW);
    const { submitter, calls } = fakeSubmitter();
    const { records, log } = fakeLog();
    const { gate } = fakeGate(WINDOW, preloaded);
    const { events: seen, onWindowEvent } = collectEvents();

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      disputeWindow: gate,
      onWindowEvent,
    });

    assert.equal(summary.heldByOperator, 2);
    assert.equal(summary.resolved, 0);
    assert.equal(records.length, 0);
    assert.ok(!calls.some((c) => c.startsWith("resolve")));
    const held = seen.filter((e) => e.kind === "held");
    assert.equal(held.length, 2);
    assert.equal(held[0].holdNote, "suspicious final");
  });

  void it("an elapsed, unheld, still-VERIFIED outcome submits with the window on the record", async () => {
    const opensAt = new Date((NOW - 2 * WINDOW) * 1000);
    const closesAt = new Date((NOW - WINDOW) * 1000);
    const preloaded = new Map<string, DisputeWindowState>([
      ["401671789", { opensAt, closesAt, heldAt: null, holdNote: null }],
    ]);
    const plan = planResolution(slate([event()]), null, NOW);
    const { submitter } = fakeSubmitter();
    const { records, log } = fakeLog();
    const { gate } = fakeGate(WINDOW, preloaded);
    const { events: seen, onWindowEvent } = collectEvents();

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      disputeWindow: gate,
      onWindowEvent,
    });

    assert.equal(summary.resolved, 2);
    assert.equal(summary.awaitingWindow, 0);
    assert.equal(summary.heldByOperator, 0);
    assert.equal(records.length, 2);
    for (const r of records) {
      assert.equal(r.method, "auto");
      assert.deepEqual(r.disputeWindow, { opensAt, closesAt });
    }
    assert.equal(seen.filter((e) => e.kind === "elapsed").length, 2);
  });

  void it("a DISPUTED confidence state refuses at the gate — the window is never consulted", async () => {
    const opensAt = new Date((NOW - 2 * WINDOW) * 1000);
    const closesAt = new Date((NOW - WINDOW) * 1000);
    const preloaded = new Map<string, DisputeWindowState>([
      ["401671789", { opensAt, closesAt, heldAt: null, holdNote: null }],
    ]);
    const plan = planResolution(slate([event()]), null, NOW);
    const { submitter, calls } = fakeSubmitter();
    const { records, log } = fakeLog();
    const { gate, opened } = fakeGate(WINDOW, preloaded);
    const { events: seen, onWindowEvent } = collectEvents();

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      confidenceOf: () => "DISPUTED",
      disputeWindow: gate,
      onWindowEvent,
    });

    assert.equal(summary.resolved, 0);
    assert.equal(summary.rejected.length, 2);
    assert.ok(summary.rejected[0].failed.some((c) => c.name === "confidence_verified"));
    assert.equal(records.length, 0);
    assert.ok(!calls.some((c) => c.startsWith("resolve")));
    assert.equal(opened.length, 0);
    assert.equal(seen.length, 0, "no window events for a gate-refused outcome");
  });

  void it("a zero window (tests/dev) opens and submits in the same pass", async () => {
    const plan = planResolution(slate([event()]), null, NOW);
    const { submitter } = fakeSubmitter();
    const { records, log } = fakeLog();
    const { gate, opened } = fakeGate(0);
    const { events: seen, onWindowEvent } = collectEvents();

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      disputeWindow: gate,
      onWindowEvent,
    });

    assert.equal(opened.length, 1);
    assert.equal(summary.windowsOpened, 1);
    assert.equal(summary.resolved, 2);
    assert.equal(records.length, 2);
    assert.ok(seen.some((e) => e.kind === "opened"));
    assert.ok(seen.some((e) => e.kind === "elapsed"));
  });

  void it("voids are window-exempt (B4-005): a cancelled game settles immediately", async () => {
    const plan = planResolution(slate([event({ status: "cancelled" })]), null, NOW);
    const { submitter, calls } = fakeSubmitter();
    const { records, log } = fakeLog();
    const { gate, opened } = fakeGate(WINDOW);

    const summary = await executeResolution(plan, submitter, log, "espn", {
      nowSeconds: NOW,
      disputeWindow: gate,
    });

    assert.equal(summary.voided, 2);
    assert.equal(opened.length, 0, "no window for voids");
    assert.equal(records.length, 2);
    assert.equal(calls.filter((c) => c === "void").length, 2);
  });

  void it("without a configured gate the legacy immediate-submit contract holds", async () => {
    const plan = planResolution(slate([event()]), null, NOW);
    const { submitter } = fakeSubmitter();
    const { records, log } = fakeLog();

    const summary = await executeResolution(plan, submitter, log, "espn", { nowSeconds: NOW });

    assert.equal(summary.resolved, 2);
    assert.equal(summary.windowsOpened, 0);
    assert.equal(summary.awaitingWindow, 0);
    assert.equal(summary.heldByOperator, 0);
    assert.equal(records.length, 2);
    assert.equal(records[0].disputeWindow, undefined);
  });
});
