import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractRawReason, mapRevert } from "./error-mapping.ts";

describe("extractRawReason", () => {
  it("returns 'Unknown error' for null/undefined", () => {
    assert.equal(extractRawReason(null), "Unknown error");
    assert.equal(extractRawReason(undefined), "Unknown error");
  });

  it("returns string input verbatim", () => {
    assert.equal(extractRawReason("revert: amount0Min"), "revert: amount0Min");
  });

  it("returns Error.message", () => {
    const err = new Error("amount1Min violated");
    assert.equal(extractRawReason(err), "amount1Min violated");
  });

  it("walks cause chain and joins with em-dash", () => {
    const inner = new Error("execution reverted: amount0Min");
    const outer = new Error("ContractFunctionExecutionError", { cause: inner });
    const got = extractRawReason(outer);
    assert.match(got, /ContractFunctionExecutionError/);
    assert.match(got, /amount0Min/);
  });

  it("does not loop on circular cause chains", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    const b: Error & { cause?: unknown } = new Error("b");
    a.cause = b;
    b.cause = a;
    const got = extractRawReason(a);
    assert.equal(got, "a — b");
  });

  it("falls back to .message on plain objects", () => {
    assert.equal(extractRawReason({ message: "object message" }), "object message");
  });

  it("falls back to String() for everything else", () => {
    assert.equal(extractRawReason(42), "42");
    assert.equal(extractRawReason(true), "true");
  });
});

describe("mapRevert", () => {
  it("maps amount0Min to 'Pool price has moved'", () => {
    const m = mapRevert("revert: amount0Min violated (expected ≥ 1.9024, got 1.8901)");
    assert.equal(m.title, "Pool price has moved");
    assert.match(m.body, /price changed/);
    assert.match(m.raw, /amount0Min/);
    assert.deepEqual(m.action, { label: "Refresh & retry", kind: "primary" });
  });

  it("maps amount1Min similarly", () => {
    const m = mapRevert("execution reverted: amount1Min");
    assert.equal(m.title, "Pool price has moved");
    assert.deepEqual(m.action, { label: "Refresh & retry", kind: "primary" });
  });

  it("matches case-insensitively", () => {
    assert.equal(mapRevert("AMOUNT0MIN").title, "Pool price has moved");
    assert.equal(mapRevert("Amount1Min").title, "Pool price has moved");
  });

  it("matches inside Error.message", () => {
    const err = new Error("revert: amount0Min");
    assert.equal(mapRevert(err).title, "Pool price has moved");
  });

  it("matches inside cause chain", () => {
    const inner = new Error("execution reverted: amount1Min");
    const outer = new Error("ContractFunctionExecutionError", { cause: inner });
    assert.equal(mapRevert(outer).title, "Pool price has moved");
  });

  it("falls through to 'Transaction reverted' for unknown reverts", () => {
    const m = mapRevert("execution reverted: insufficient liquidity");
    assert.equal(m.title, "Transaction reverted");
    assert.equal(m.body, "execution reverted: insufficient liquidity");
    assert.equal(m.raw, "execution reverted: insufficient liquidity");
    assert.equal(m.action, undefined);
  });

  it("does not match similar-looking but different patterns", () => {
    assert.equal(mapRevert("amountMin without index").title, "Transaction reverted");
    assert.equal(mapRevert("amount2Min").title, "Transaction reverted");
  });

  it("preserves raw on every branch", () => {
    const knownRaw = "amount0Min violated";
    assert.equal(mapRevert(knownRaw).raw, knownRaw);
    const unknownRaw = "some other revert";
    assert.equal(mapRevert(unknownRaw).raw, unknownRaw);
  });

  it("handles null/undefined safely", () => {
    assert.equal(mapRevert(null).title, "Transaction reverted");
    assert.equal(mapRevert(null).raw, "Unknown error");
    assert.equal(mapRevert(undefined).title, "Transaction reverted");
  });
});
