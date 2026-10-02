import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readOutcomeBalances } from "./outcome-balances.ts";

const OWNER = "0x0eea000000000000000000000000000000009c03";
const LIVE = {
  yesToken: "0x1111111111111111111111111111111111111111",
  noToken: "0x2222222222222222222222222222222222222222",
};
// The address from the production failure: no code on the live chain.
const DEAD = {
  yesToken: "0x23037a7d9165e83565d74B543232cE928029717f",
  noToken: "0x3333333333333333333333333333333333333333",
};

const client = {
  readContract: (args: { address: `0x${string}` }) => {
    if (args.address === DEAD.yesToken) {
      return Promise.reject(
        new Error('The contract function "balanceOf" returned no data ("0x").'),
      );
    }
    return Promise.resolve(args.address === LIVE.yesToken ? 5n : 0n);
  },
};

void describe("readOutcomeBalances", () => {
  void it("returns both balances for a readable market", async () => {
    assert.deepEqual(await readOutcomeBalances(client, LIVE, OWNER), { yes: 5n, no: 0n });
  });
  void it("returns null, not an exception, when a token has no contract behind it", async () => {
    assert.equal(await readOutcomeBalances(client, DEAD, OWNER), null);
  });
  void it("one dead market does not stop the others from being read", async () => {
    const all = await Promise.all([DEAD, LIVE].map((m) => readOutcomeBalances(client, m, OWNER)));
    assert.deepEqual(all, [null, { yes: 5n, no: 0n }]);
  });
});
