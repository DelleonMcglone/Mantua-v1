/**
 * T-024 — Dynamic Market Hook reverts decode to named reasons instead of
 * collapsing into the generic quote failure.
 *
 * Revert payloads are built the way they reach us on-chain: `quoteFee`
 * reverts with the bare custom error; the V4Quoter path nests it as
 * `UnexpectedRevertBytes(WrappedError(hook, selector, reason, details))`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BaseError,
  encodeAbiParameters,
  encodeErrorResult,
  parseAbi,
  toFunctionSelector,
  type Hex,
} from "viem";
import {
  MARKET_HOOK_TRADE_ERRORS_ABI,
  MarketHookRevertError,
  decodeMarketHookRevert,
  marketHookRevertResponse,
  withMarketHookErrors,
} from "./market-hook-errors.ts";

const HOOK = "0xb23d3EeC2272F3557f6B7BBEA8A9649Cf9c028c0";

/** A viem-shaped revert carrying raw revert data, as the RPC client throws. */
class RevertWithData extends BaseError {
  readonly data: Hex;
  constructor(data: Hex) {
    super("execution reverted");
    this.data = data;
  }
}

function hookError(name: string, args?: readonly unknown[]): Hex {
  return encodeErrorResult({
    abi: MARKET_HOOK_TRADE_ERRORS_ABI,
    errorName: name as "MarketPaused",
    ...(args ? { args: args as never } : {}),
  });
}

/** PoolManager's WrappedError around the hook's reason, inside V4Quoter's
 *  UnexpectedRevertBytes — the shape a failed quote actually returns. */
function viaQuoter(reason: Hex): Hex {
  const wrapped = encodeErrorResult({
    abi: parseAbi([
      "error WrappedError(address target, bytes4 selector, bytes reason, bytes details)",
    ]),
    errorName: "WrappedError",
    args: [
      HOOK,
      toFunctionSelector(
        "beforeSwap(address,(address,address,uint24,int24,address),(bool,int256,uint160),bytes)",
      ),
      reason,
      "0x",
    ],
  });
  return ("0x6190b2b0" + encodeAbiParameters([{ type: "bytes" }], [wrapped]).slice(2)) as Hex;
}

void describe("MarketErrors mirror", () => {
  void it("pins the selectors MarketErrors.sol emits (cast sig)", () => {
    const expected: Record<string, string> = {
      MarketPaused: "0x54882d18",
      MarketResolved: "0x55e8cb5f",
      MarketVoided: "0x173a2fb3",
      MarketFrozen: "0xb2ce2a93",
      TradeExceedsCap: "0x15866bde",
      PoolNotRegistered: "0x739f4185",
    };
    for (const [name, selector] of Object.entries(expected)) {
      const args = name === "TradeExceedsCap" ? [1n, 2n] : undefined;
      assert.equal(hookError(name, args).slice(0, 10), selector, name);
    }
  });
});

void describe("decodeMarketHookRevert", () => {
  const halts: [string, string][] = [
    ["MarketPaused", "paused"],
    ["MarketResolved", "resolved"],
    ["MarketVoided", "voided"],
    ["MarketFrozen", "frozen"],
    ["PoolNotRegistered", "not_registered"],
  ];

  void it("names each halt from a direct quoteFee revert", () => {
    for (const [name, reason] of halts) {
      const err = decodeMarketHookRevert(new RevertWithData(hookError(name)));
      assert.ok(err instanceof MarketHookRevertError, name);
      assert.equal(err.reason, reason);
    }
  });

  void it("names each halt through the quoter's UnexpectedRevertBytes(WrappedError(...)) nesting", () => {
    for (const [name, reason] of halts) {
      const err = decodeMarketHookRevert(new RevertWithData(viaQuoter(hookError(name))));
      assert.equal(err?.reason, reason, name);
    }
  });

  void it("carries the notional and cap of a TradeExceedsCap revert", () => {
    const err = decodeMarketHookRevert(
      new RevertWithData(viaQuoter(hookError("TradeExceedsCap", [250_000_000n, 100_000_000n]))),
    );
    assert.ok(err);
    assert.equal(err.reason, "exceeds_cap");
    assert.equal(err.notional, 250_000_000n);
    assert.equal(err.cap, 100_000_000n);
  });

  void it("returns null for anything that is not a hook trade error", () => {
    assert.equal(decodeMarketHookRevert(new Error("fetch failed")), null);
    const notEnoughLiquidity = encodeErrorResult({
      abi: parseAbi(["error NotEnoughLiquidity(bytes32 poolId)"]),
      errorName: "NotEnoughLiquidity",
      args: [`0x${"11".repeat(32)}`],
    });
    assert.equal(decodeMarketHookRevert(new RevertWithData(viaQuoter(notEnoughLiquidity))), null);
  });
});

void describe("withMarketHookErrors", () => {
  void it("turns a hook revert into a MarketHookRevertError and rethrows the rest unchanged", async () => {
    await assert.rejects(
      withMarketHookErrors(() => Promise.reject(new RevertWithData(hookError("MarketFrozen")))),
      (e: unknown) => e instanceof MarketHookRevertError && e.reason === "frozen",
    );
    const transport = new Error("socket hang up");
    await assert.rejects(
      withMarketHookErrors(() => Promise.reject(transport)),
      (e: unknown) => e === transport,
    );
    assert.equal(await withMarketHookErrors(() => Promise.resolve(7)), 7);
  });
});

void describe("marketHookRevertResponse", () => {
  void it("maps each reason to a distinct code and a status that says whether it clears", () => {
    const cases: [MarketHookRevertError, number, string][] = [
      [new MarketHookRevertError("paused"), 503, "MARKET_PAUSED"],
      [new MarketHookRevertError("not_registered"), 503, "MARKET_NOT_OPEN"],
      [new MarketHookRevertError("resolved"), 409, "MARKET_RESOLVED"],
      [new MarketHookRevertError("voided"), 409, "MARKET_VOIDED"],
      [new MarketHookRevertError("frozen"), 409, "MARKET_FROZEN"],
    ];
    for (const [err, status, code] of cases) {
      const res = marketHookRevertResponse(err);
      assert.equal(res.status, status, code);
      assert.equal(res.body.code, code);
      assert.equal(res.body.details, undefined);
    }
  });

  void it("returns the cap as raw 6dp strings so the ticket can name it", () => {
    const res = marketHookRevertResponse(
      new MarketHookRevertError("exceeds_cap", { notional: 250_000_000n, cap: 100_000_000n }),
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "TRADE_EXCEEDS_CAP");
    assert.deepEqual(res.body.details, { notional: "250000000", cap: "100000000" });
  });
});
