import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env["NODE_ENV"] ??= "test";
process.env["DATABASE_URL"] ??= "postgres://localhost:5432/mantua";
process.env["PRIVY_APP_ID"] ??= "test";
process.env["PRIVY_APP_SECRET"] ??= "test";

const { armExitInput, describeExit } = await import("./agent-exits.ts");
const MARKET = `0x${"ab".repeat(32)}`;

void describe("arm exit", () => {
  void it("describes a take-profit and stop in the user's words", () => {
    const c = armExitInput.parse({
      marketId: MARKET,
      side: "yes",
      takeProfitBps: 7000,
      stopBps: 4000,
    });
    assert.equal(
      describeExit(c),
      "YES position: take profit when YES reaches 70%; stop out when YES falls to 40%.",
    );
  });
  void it("rejects a rule with neither threshold, or a stop above the take-profit", async () => {
    const { takeProfitStopSchema } = await import("./strategies.ts");
    const base = { kind: "take-profit-stop", marketId: MARKET, side: "yes" };
    assert.equal(takeProfitStopSchema.safeParse(base).success, false);
    assert.equal(
      takeProfitStopSchema.safeParse({ ...base, takeProfitBps: 4000, stopBps: 7000 }).success,
      false,
    );
  });
  void it("rejects an unknown field so a malformed call cannot widen its own authority", () => {
    assert.equal(
      armExitInput.safeParse({ marketId: MARKET, side: "yes", takeProfitBps: 7000, amount: 5 })
        .success,
      false,
    );
  });
});
