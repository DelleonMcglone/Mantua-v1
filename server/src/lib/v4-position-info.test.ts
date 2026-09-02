import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodePositionInfo } from "./v4-position-info.ts";

/**
 * PositionInfo packing (v4-periphery PositionInfoLibrary):
 *   bits  0..7    hasSubscriber
 *   bits  8..31   tickLower (int24, sign-extended)
 *   bits 32..55   tickUpper (int24, sign-extended)
 */
function pack(opts: { hasSubscriber?: boolean; tickLower: number; tickUpper: number }): bigint {
  const MASK_24 = 0xffffffn;
  const lower = BigInt(opts.tickLower) & MASK_24;
  const upper = BigInt(opts.tickUpper) & MASK_24;
  const sub = opts.hasSubscriber ? 1n : 0n;
  return (upper << 32n) | (lower << 8n) | sub;
}

describe("decodePositionInfo", () => {
  it("decodes a typical positive-tick range", () => {
    const info = pack({ tickLower: 100, tickUpper: 200 });
    assert.deepEqual(decodePositionInfo(info), {
      hasSubscriber: false,
      tickLower: 100,
      tickUpper: 200,
    });
  });

  it("sign-extends negative ticks", () => {
    const info = pack({ tickLower: -887220, tickUpper: 887220 });
    assert.deepEqual(decodePositionInfo(info), {
      hasSubscriber: false,
      tickLower: -887220,
      tickUpper: 887220,
    });
  });

  it("decodes the int24 minimum and maximum", () => {
    const info = pack({ tickLower: -8388608, tickUpper: 8388607 });
    assert.deepEqual(decodePositionInfo(info), {
      hasSubscriber: false,
      tickLower: -8388608,
      tickUpper: 8388607,
    });
  });

  it("treats tick=0 as zero (not -16777216)", () => {
    const info = pack({ tickLower: 0, tickUpper: 0 });
    assert.deepEqual(decodePositionInfo(info), {
      hasSubscriber: false,
      tickLower: 0,
      tickUpper: 0,
    });
  });

  it("reports hasSubscriber when the low byte is set", () => {
    const info = pack({ hasSubscriber: true, tickLower: -10, tickUpper: 10 });
    assert.equal(decodePositionInfo(info).hasSubscriber, true);
    assert.equal(decodePositionInfo(info).tickLower, -10);
  });

  it("ignores upper poolId bits and reads only the tick fields", () => {
    // simulate a real PositionInfo with non-zero poolId in the upper 200 bits
    const base = pack({ tickLower: -60, tickUpper: 60 });
    const poolIdNoise = BigInt("0x" + "ab".repeat(25)) << 56n;
    const info = base | poolIdNoise;
    assert.deepEqual(decodePositionInfo(info), {
      hasSubscriber: false,
      tickLower: -60,
      tickUpper: 60,
    });
  });
});
