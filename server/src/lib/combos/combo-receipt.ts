import { parseAbi, parseEventLogs, type Log } from "viem";

/**
 * Task 072 / CB-005 — what a verified receipt says a combo swap moved.
 * The client's report is never believed for amounts or for which market
 * traded: the ERC-20 `Transfer` logs of the combo's YES token and of USDC
 * against the sender's wallet are the record. Null when the receipt does
 * not show a swap of this combo's token by this wallet — the report is
 * refused, not corrected.
 */

const ERC20_TRANSFER_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export interface SwapAmounts {
  /** YES shares the wallet received (buy) or sent (sell), raw 6dp. */
  tokensRaw: bigint;
  /** USDC the wallet sent (buy) or received (sell), raw 6dp. */
  usdcRaw: bigint;
}

function transfersOf(logs: readonly Log[], token: `0x${string}`) {
  return parseEventLogs({
    abi: ERC20_TRANSFER_ABI,
    eventName: "Transfer",
    logs: logs.filter((l) => l.address.toLowerCase() === token.toLowerCase()),
  });
}

function sum(
  transfers: ReturnType<typeof transfersOf>,
  side: "from" | "to",
  wallet: `0x${string}`,
): bigint {
  let total = 0n;
  for (const t of transfers) {
    if (t.args[side].toLowerCase() === wallet.toLowerCase()) total += t.args.value;
  }
  return total;
}

export function swapAmountsFromLogs(
  logs: readonly Log[],
  input: {
    yesToken: `0x${string}`;
    usdc: `0x${string}`;
    wallet: `0x${string}`;
    direction: "buy" | "sell";
  },
): SwapAmounts | null {
  const yes = transfersOf(logs, input.yesToken);
  const usdc = transfersOf(logs, input.usdc);
  const buy = input.direction === "buy";
  const tokensRaw = sum(yes, buy ? "to" : "from", input.wallet);
  const usdcRaw = sum(usdc, buy ? "from" : "to", input.wallet);
  if (tokensRaw === 0n || usdcRaw === 0n) return null;
  return { tokensRaw, usdcRaw };
}
