/**
 * Decoder for v4 PositionManager `PositionInfo` — a packed uint256.
 *
 * Layout (matches v4-periphery PositionInfoLibrary):
 *   bits  0..7    hasSubscriber   (uint8)
 *   bits  8..31   tickLower       (int24, sign-extended)
 *   bits 32..55   tickUpper       (int24, sign-extended)
 *   bits 56..255  poolId          (bytes25, truncated)
 */
export interface PositionInfo {
  hasSubscriber: boolean;
  tickLower: number;
  tickUpper: number;
}

const MASK_8 = 0xffn;
const MASK_24 = 0xffffffn;
const SIGN_BIT_24 = 1n << 23n;
const SPAN_24 = 1n << 24n;

function signExtend24(raw: bigint): number {
  const masked = raw & MASK_24;
  return Number(masked & SIGN_BIT_24 ? masked - SPAN_24 : masked);
}

export function decodePositionInfo(info: bigint): PositionInfo {
  return {
    hasSubscriber: (info & MASK_8) !== 0n,
    tickLower: signExtend24(info >> 8n),
    tickUpper: signExtend24(info >> 32n),
  };
}
