import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, parseAbi, toHex, type Log } from "viem";
import { swapAmountsFromLogs } from "./combo-receipt.ts";

/** Task 072 / CB-005 — amounts and the traded market come from the receipt, never the client. */

const ABI = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const YES = "0x00000000000000000000000000000000000000ee" as const;
const USDC = "0x00000000000000000000000000000000000000cc" as const;
const OTHER = "0x00000000000000000000000000000000000000dd" as const;
const WALLET = "0x00000000000000000000000000000000000000aa" as const;
const POOL = "0x00000000000000000000000000000000000000bb" as const;

function transfer(
  token: `0x${string}`,
  from: `0x${string}`,
  to: `0x${string}`,
  value: bigint,
): Log {
  const topics = encodeEventTopics({ abi: ABI, eventName: "Transfer", args: { from, to } });
  return {
    address: token,
    topics,
    data: toHex(value, { size: 32 }),
    blockNumber: 1n,
    transactionHash: "0x1",
    transactionIndex: 0,
    blockHash: "0x2",
    logIndex: 0,
    removed: false,
  } as unknown as Log;
}

void describe("swapAmountsFromLogs", () => {
  void it("a buy: USDC out of the wallet, YES into it", () => {
    const logs = [
      transfer(USDC, WALLET, POOL, 10_000_000n),
      transfer(YES, POOL, WALLET, 40_000_000n),
    ];
    assert.deepEqual(
      swapAmountsFromLogs(logs, { yesToken: YES, usdc: USDC, wallet: WALLET, direction: "buy" }),
      {
        tokensRaw: 40_000_000n,
        usdcRaw: 10_000_000n,
      },
    );
  });
  void it("a sell: YES out, USDC in; the same receipt is not a buy", () => {
    const logs = [
      transfer(YES, WALLET, POOL, 40_000_000n),
      transfer(USDC, POOL, WALLET, 9_000_000n),
    ];
    assert.deepEqual(
      swapAmountsFromLogs(logs, { yesToken: YES, usdc: USDC, wallet: WALLET, direction: "sell" }),
      {
        tokensRaw: 40_000_000n,
        usdcRaw: 9_000_000n,
      },
    );
    assert.equal(
      swapAmountsFromLogs(logs, { yesToken: YES, usdc: USDC, wallet: WALLET, direction: "buy" }),
      null,
    );
  });
  void it("refuses a receipt for another token or another wallet", () => {
    const logs = [
      transfer(USDC, WALLET, POOL, 10_000_000n),
      transfer(OTHER, POOL, WALLET, 40_000_000n),
    ];
    assert.equal(
      swapAmountsFromLogs(logs, { yesToken: YES, usdc: USDC, wallet: WALLET, direction: "buy" }),
      null,
    );
    const theirs = [transfer(USDC, POOL, POOL, 1n), transfer(YES, POOL, POOL, 1n)];
    assert.equal(
      swapAmountsFromLogs(theirs, { yesToken: YES, usdc: USDC, wallet: WALLET, direction: "buy" }),
      null,
    );
  });
});
