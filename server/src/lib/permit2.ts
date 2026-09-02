import { baseRpcClient } from "./rpc-client.ts";
import { ZERO_ADDRESS } from "./tokens.ts";
import { PERMIT2, PERMIT2_ABI } from "./v4-contracts.ts";

/** type(uint160).max — the max amount Permit2 stores in a single allowance. */
export const PERMIT2_MAX_AMOUNT = (1n << 160n) - 1n;

/** Allowance window we ask the user to sign — long enough to cover slow
 *  Base blocks + retries, short enough that a leaked signature can't
 *  drain a wallet a week later. */
export const PERMIT2_EXPIRATION_SECONDS = 30 * 60;

export interface PermitDetailsLive {
  token: `0x${string}`;
  amount: bigint;
  expiration: number;
  nonce: number;
}

/** Read Permit2 → PositionManager allowance for one token. */
export async function readPermit2Allowance(
  owner: `0x${string}`,
  token: `0x${string}`,
  positionManager: `0x${string}`,
): Promise<PermitDetailsLive> {
  const [amount, expiration, nonce] = await baseRpcClient.readContract({
    address: PERMIT2,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [owner, token, positionManager],
  });
  return { token, amount, expiration, nonce };
}

/**
 * Returns true if the existing Permit2 → PM allowance is sufficient to
 * cover `amountNeeded` and the expiration is far enough in the future to
 * survive normal block times. Cushion is 5 minutes — block-confirmation
 * tolerance.
 */
export function isPermit2AllowanceFresh(
  details: PermitDetailsLive,
  amountNeeded: bigint,
  nowSeconds: number,
): boolean {
  return details.amount >= amountNeeded && details.expiration > nowSeconds + 300;
}

export interface PermitBatchInput {
  details: { token: `0x${string}`; amount: bigint; expiration: number; nonce: number }[];
  spender: `0x${string}`;
  sigDeadline: bigint;
}

export interface PermitBatchTypedData {
  domain: {
    name: "Permit2";
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    PermitDetails: { name: string; type: string }[];
    PermitBatch: { name: string; type: string }[];
  };
  primaryType: "PermitBatch";
  message: PermitBatchInput;
}

const PERMIT_BATCH_TYPES: PermitBatchTypedData["types"] = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitBatch: [
    { name: "details", type: "PermitDetails[]" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
};

/**
 * Build the EIP-712 typed data + raw struct the user signs to grant
 * Permit2 allowance to PositionManager. Caller filters out the native
 * ETH side (Permit2 only handles ERC-20s — native is paid via msg.value).
 *
 * Important: the EIP-712 domain has only three fields (name, chainId,
 * verifyingContract). Permit2 deliberately omits `version`. Adding it
 * here would produce a non-verifying signature.
 */
export async function buildPermit2BatchTypedData(args: {
  owner: `0x${string}`;
  chainId: number;
  /** The PositionManager being approved as spender — per-hook (the pool's
   *  hook determines which PositionManager its liquidity routes through). */
  positionManager: `0x${string}`;
  tokens: { address: `0x${string}`; amountNeeded: bigint }[];
  nowSeconds: number;
}): Promise<{ typedData: PermitBatchTypedData; permitBatch: PermitBatchInput } | null> {
  const erc20s = args.tokens.filter((t) => t.address !== ZERO_ADDRESS);
  if (erc20s.length === 0) return null;

  const expiration = args.nowSeconds + PERMIT2_EXPIRATION_SECONDS;
  const sigDeadline = BigInt(expiration);

  const liveDetails = await Promise.all(
    erc20s.map((t) => readPermit2Allowance(args.owner, t.address, args.positionManager)),
  );

  const allFresh = liveDetails.every((d, i) => {
    const needed = erc20s[i]?.amountNeeded ?? 0n;
    return isPermit2AllowanceFresh(d, needed, args.nowSeconds);
  });
  if (allFresh) return null;

  const details = liveDetails.map((d) => ({
    token: d.token,
    amount: PERMIT2_MAX_AMOUNT,
    expiration,
    nonce: d.nonce,
  }));

  const permitBatch: PermitBatchInput = {
    details,
    spender: args.positionManager,
    sigDeadline,
  };

  const typedData: PermitBatchTypedData = {
    domain: {
      name: "Permit2",
      chainId: args.chainId,
      verifyingContract: PERMIT2,
    },
    types: PERMIT_BATCH_TYPES,
    primaryType: "PermitBatch",
    message: permitBatch,
  };

  return { typedData, permitBatch };
}
