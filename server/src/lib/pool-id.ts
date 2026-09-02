import { encodeAbiParameters, keccak256 } from "viem";
import type { PoolKey } from "./pool-key.ts";

/**
 * Canonical Uniswap v4 PoolId — `keccak256(abi.encode(PoolKey))`. This is
 * what StateView, PoolManager extsload slots, and the v4 subgraph all key
 * pools by. Distinct from Mantua's internal `pool_key_hash` (a
 * string-concatenation hash kept in our `pools` table for joins).
 */
const POOL_KEY_TUPLE = [
  {
    type: "tuple",
    components: [
      { type: "address", name: "currency0" },
      { type: "address", name: "currency1" },
      { type: "uint24", name: "fee" },
      { type: "int24", name: "tickSpacing" },
      { type: "address", name: "hooks" },
    ],
  },
] as const;

export function computePoolId(key: PoolKey): `0x${string}` {
  return keccak256(encodeAbiParameters(POOL_KEY_TUPLE, [key]));
}
