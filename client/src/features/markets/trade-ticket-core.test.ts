import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  AMOUNT_PRESETS,
  TAP_BUDGET,
  countTaps,
  initialTicket,
  needsFunding,
  tapTicket,
  ticketReadiness,
  type TicketTap,
} from "./trade-ticket-core.ts";

test("a buy is three taps: price → preset → confirm (T-002)", () => {
  const taps: TicketTap[] = [
    { kind: "pick", side: 0 },
    { kind: "preset", amount: 25 },
    { kind: "confirm" },
  ];
  let state = initialTicket();
  for (const tap of taps) state = tapTicket(state, tap);
  assert.equal(state.step, "executing");
  assert.equal(state.side, 0);
  assert.equal(state.amount, "25");
  assert.equal(state.direction, "buy");
  assert.equal(countTaps(taps), 3);
  assert.ok(countTaps(taps) <= TAP_BUDGET, "three is the budget");
});

test("an exit is two taps: close → confirm (T-011)", () => {
  const taps: TicketTap[] = [
    { kind: "close", side: 0, balanceRaw: "12500000" },
    { kind: "confirm" },
  ];
  let state = initialTicket();
  for (const tap of taps) state = tapTicket(state, tap);
  assert.equal(state.step, "executing");
  assert.equal(state.direction, "sell");
  assert.equal(state.amount, "12.5", "Close pre-fills the exact held balance");
  assert.equal(countTaps(taps), 2);
});

test("presets replace the amount rather than accumulating it", () => {
  let state = tapTicket(initialTicket(), { kind: "pick", side: 1 });
  state = tapTicket(state, { kind: "preset", amount: 10 });
  state = tapTicket(state, { kind: "preset", amount: 100 });
  assert.equal(state.amount, "100");
  assert.deepEqual(AMOUNT_PRESETS, [10, 25, 50, 100]);
});

test("confirm is a no-op until a side and a positive amount exist", () => {
  const noSide = tapTicket(initialTicket(), { kind: "confirm" });
  assert.equal(noSide.step, "pick");
  const noAmount = tapTicket(tapTicket(initialTicket(), { kind: "pick", side: 0 }), {
    kind: "confirm",
  });
  assert.equal(noAmount.step, "amount");
});

test("typing an amount is one tap-equivalent and switching direction keeps the side", () => {
  let state = tapTicket(initialTicket(), { kind: "pick", side: 1 });
  state = tapTicket(state, { kind: "type", amount: "42.5" });
  assert.equal(state.amount, "42.5");
  state = tapTicket(state, { kind: "direction", direction: "sell" });
  assert.equal(state.side, 1);
  assert.equal(state.direction, "sell");
  assert.equal(state.amount, "0", "a direction switch resets the amount (units differ)");
});

test("execution outcomes: executed, failed, and reset back to the amount step", () => {
  let state = initialTicket();
  for (const tap of [
    { kind: "pick", side: 0 },
    { kind: "preset", amount: 50 },
    { kind: "confirm" },
  ] as TicketTap[])
    state = tapTicket(state, tap);
  const done = tapTicket(state, { kind: "executed" });
  assert.equal(done.step, "executed");
  const failed = tapTicket(state, { kind: "failed" });
  assert.equal(failed.step, "error");
  const again = tapTicket(done, { kind: "reset" });
  assert.equal(again.step, "amount");
  assert.equal(again.side, 0, "Trade again keeps the side");
  assert.equal(again.amount, "0");
});

test("needsFunding compares the ticket total against the USDC balance (T-013)", () => {
  assert.equal(needsFunding("buy", "100000000", "99999999"), true);
  assert.equal(needsFunding("buy", "100000000", "100000000"), false, "exact balance suffices");
  assert.equal(needsFunding("buy", "100000000", null), false, "unknown balance never blocks");
  assert.equal(needsFunding("sell", "100000000", "0"), false, "sells spend contracts, not USDC");
});

test("ticketReadiness picks the one button the user sees", () => {
  assert.equal(ticketReadiness({ authenticated: false, quoted: false, funding: false }), "login");
  assert.equal(ticketReadiness({ authenticated: true, quoted: true, funding: true }), "fund");
  assert.equal(ticketReadiness({ authenticated: true, quoted: true, funding: false }), "ready");
  assert.equal(ticketReadiness({ authenticated: true, quoted: false, funding: false }), "waiting");
});
