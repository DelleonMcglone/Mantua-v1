import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeTradeError, insufficientBalanceError } from "./trade-errors.ts";

/** The shape `lib/api.ts`'s ApiError carries — duck-typed here so the
 *  test stays free of the Privy import that module pulls in. */
class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const server = (status: number, code: string, message = "server said so") =>
  new ApiError(status, code, message);

test("every server code the trade route can return has owner-readable copy (T-012)", () => {
  const cases: [ApiError, RegExp][] = [
    [server(409, "BETTING_CLOSED"), /closed/i],
    [server(503, "TRADING_HALTED"), /paused|halted|feed/i],
    [server(400, "spending_cap_exceeded"), /daily limit|cap/i],
    [server(400, "spending_cap_hard_ceiling"), /limit/i],
    [server(503, "KILL_SWITCH_ACTIVE"), /paused/i],
    [server(400, "kill_switch_active"), /paused/i],
    [server(503, "MARKETS_NOT_DEPLOYED"), /soon/i],
    [server(404, "NO_MARKET"), /no market/i],
    [server(502, "QUOTE_FAILED"), /size|smaller/i],
    [server(429, "RATE_LIMITED"), /slow down|moment/i],
    [server(401, "UNAUTHENTICATED"), /log in/i],
    [server(401, "WALLET_REQUIRED"), /log in|wallet/i],
    [server(400, "slippage_too_high"), /moved|price/i],
    [server(400, "BAD_REQUEST"), /amount/i],
  ];
  for (const [err, expect] of cases) {
    const copy = describeTradeError(err);
    assert.match(`${copy.title} ${copy.body}`, expect, err.code);
    assert.ok(copy.title.length > 0 && copy.body.length > 0, err.code);
  }
});

test("a declined wallet signature says nothing was placed", () => {
  const copy = describeTradeError(new Error("User rejected the request."));
  assert.equal(copy.kind, "declined");
  assert.match(copy.body, /nothing was placed/i);
});

test("a reverted transaction and an unknown error both get a retry action", () => {
  const reverted = describeTradeError(new Error("Transaction reverted"));
  assert.equal(reverted.kind, "reverted");
  assert.ok(reverted.action);
  const unknown = describeTradeError({ weird: true });
  assert.equal(unknown.kind, "unknown");
  assert.ok(unknown.action);
});

test("insufficient balance copy names the shortfall in dollars", () => {
  const copy = insufficientBalanceError("100000000", "40000000");
  assert.equal(copy.kind, "insufficient-balance");
  assert.match(copy.body, /\$60\.00/);
  assert.equal(copy.action?.label, "Add funds");
});

test("copy never leaks chain vocabulary", () => {
  const codes = [
    "BETTING_CLOSED",
    "TRADING_HALTED",
    "MARKETS_NOT_DEPLOYED",
    "QUOTE_FAILED",
    "wrong_chain",
    "wallet_unknown",
  ];
  for (const code of codes) {
    const copy = describeTradeError(server(400, code));
    assert.doesNotMatch(
      `${copy.title} ${copy.body}`,
      /\b(gas|ETH|on-chain|network|chain)\b/i,
      code,
    );
  }
});
