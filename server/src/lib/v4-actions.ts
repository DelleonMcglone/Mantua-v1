import { encodeAbiParameters } from "viem";

/**
 * Action IDs from v4-periphery's `Actions.sol`. Each byte in the
 * `actions` blob of `unlockData` is one of these.
 */
export const Action = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x11,
  SWEEP: 0x14,
  CLOSE_CURRENCY: 0x12,
} as const;

export type ActionId = (typeof Action)[keyof typeof Action];

/** Concatenate action bytes into the `actions` parameter of unlockData. */
export function encodeActions(ids: readonly ActionId[]): `0x${string}` {
  return ("0x" + ids.map((id) => id.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

const POOL_KEY_TUPLE = {
  type: "tuple",
  components: [
    { type: "address", name: "currency0" },
    { type: "address", name: "currency1" },
    { type: "uint24", name: "fee" },
    { type: "int24", name: "tickSpacing" },
    { type: "address", name: "hooks" },
  ],
} as const;

export interface MintPositionArgs {
  poolKey: {
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
  };
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: `0x${string}`;
  hookData: `0x${string}`;
}

export function encodeMintPosition(args: MintPositionArgs): `0x${string}` {
  return encodeAbiParameters(
    [
      POOL_KEY_TUPLE,
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      args.poolKey,
      args.tickLower,
      args.tickUpper,
      args.liquidity,
      args.amount0Max,
      args.amount1Max,
      args.owner,
      args.hookData,
    ],
  );
}

/** SETTLE_PAIR(currency0, currency1) — pulls both currencies from caller. */
export function encodeSettlePair(c0: `0x${string}`, c1: `0x${string}`): `0x${string}` {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }], [c0, c1]);
}

/** SWEEP(currency, to) — refunds any leftover currency to `to`. */
export function encodeSweep(currency: `0x${string}`, to: `0x${string}`): `0x${string}` {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }], [currency, to]);
}

/** Bundle (actions, params[]) into a single `unlockData` bytes blob. */
export function encodeUnlockData(
  actions: `0x${string}`,
  params: readonly `0x${string}`[],
): `0x${string}` {
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]);
}
