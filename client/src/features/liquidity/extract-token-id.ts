import type { Log, TransactionReceipt } from "viem";
import { V4_POSITION_MANAGER } from "@/lib/tokens.ts";

const ZERO_ADDRESS_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000000";
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Find the PositionManager `Transfer(0x0, owner, tokenId)` event in the
 * receipt and return the tokenId as a decimal string. Returns null if
 * no mint event was found (failed tx, or different recipient).
 *
 * `positionManager` is per-hook: each Mantua hook has its own
 * PositionManager, so the mint event comes from the pool's hook stack.
 * Pass the add-liquidity calldata `to` (the resolved per-hook PM);
 * defaults to the hero PositionManager when omitted.
 */
export function extractMintedTokenId(
  receipt: TransactionReceipt,
  owner: `0x${string}`,
  positionManager: `0x${string}` = V4_POSITION_MANAGER,
): string | null {
  const ownerTopic = `0x${"0".repeat(24)}${owner.slice(2).toLowerCase()}`;
  const positionManagerLower = positionManager.toLowerCase();
  const mint = receipt.logs.find(
    (l: Log) =>
      l.address.toLowerCase() === positionManagerLower &&
      l.topics[0] === TRANSFER_TOPIC &&
      l.topics[1]?.toLowerCase() === ZERO_ADDRESS_TOPIC &&
      l.topics[2]?.toLowerCase() === ownerTopic,
  );
  if (!mint?.topics[3]) return null;
  // tokenId is in topics[3] as hex; convert to decimal string via BigInt.
  return BigInt(mint.topics[3]).toString();
}
