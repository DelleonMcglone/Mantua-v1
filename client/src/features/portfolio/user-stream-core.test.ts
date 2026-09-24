import { strict as assert } from "node:assert";
import { test } from "node:test";
import { frameIsFor, parseBalancesFrame, parsePositionsFrame } from "./user-stream-core.ts";

const WALLET = "0x00000000000000000000000000000000000000aa";

const position = {
  marketId: "0xm",
  outcomeIndex: 0,
  label: "AAA to beat BBB",
  state: "open",
  startsAt: 1_800_000_000,
  side: "yes",
  balance: "1000000",
  impliedProbBps: 5000,
  valueRaw: "500000",
  league: "nfl",
  providerEventId: "401",
  entryPriceBps: 4800,
  pnlRaw: "20000",
  potentialPayoutRaw: "1000000",
};
const usdc = {
  symbol: "USDC",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
  balanceRaw: "5000000",
  usdValue: 5,
};

test("parses the server's positions and balances frames (R-001)", () => {
  const p = parsePositionsFrame({ wallet: WALLET, positions: [position] });
  assert.ok(p);
  assert.equal(p.positions[0]?.balance, "1000000");
  const b = parseBalancesFrame({ wallet: WALLET, chainId: 8453, balances: [usdc] });
  assert.ok(b);
  assert.equal(b.balances[0]?.balanceRaw, "5000000");
  assert.equal(b.chainId, 8453);
});

test("a malformed frame is dropped whole, never half-applied", () => {
  assert.equal(parsePositionsFrame(null), null);
  assert.equal(parsePositionsFrame({ wallet: "nope", positions: [] }), null);
  assert.equal(
    parsePositionsFrame({ wallet: WALLET, positions: [{ ...position, side: "maybe" }] }),
    null,
  );
  assert.equal(parseBalancesFrame({ wallet: WALLET, balances: [usdc] }), null, "no chainId");
  assert.equal(
    parseBalancesFrame({
      wallet: WALLET,
      chainId: 8453,
      balances: [{ ...usdc, balanceRaw: "1.5" }],
    }),
    null,
  );
});

test("frames apply only to the wallet they were authenticated for", () => {
  const frame = { wallet: WALLET };
  assert.equal(frameIsFor(frame, WALLET.toUpperCase().replace("0X", "0x")), true);
  assert.equal(frameIsFor(frame, "0x00000000000000000000000000000000000000bb"), false);
  assert.equal(frameIsFor(frame, null), false);
});
