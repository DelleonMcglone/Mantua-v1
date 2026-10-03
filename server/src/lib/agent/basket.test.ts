import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { basketExecutionArgs, executeBasket, planBasket, summarizeFills } from "./basket.ts";

const legs = [
  { providerEventId: "401", outcomeIndex: 0 as const, amount: 60, label: "Browns YES" },
  { providerEventId: "402", outcomeIndex: 1 as const, amount: 40, label: "Raiders YES" },
];

void describe("planBasket", () => {
  void it("totals the legs and keeps them inside the budget", () => {
    const p = planBasket({ legs, budgetUsdc: 100 });
    assert.equal(p.totalUsdc, 100);
    assert.equal(p.budgetUsdc, 100);
  });
  void it("refuses legs that exceed the budget", () => {
    assert.throws(() => planBasket({ legs, budgetUsdc: 90 }), /over the 90\.00 USDC budget/);
  });
  void it("refuses two legs on the same market", () => {
    assert.throws(() => planBasket({ legs: [legs[0], { ...legs[0], amount: 5 }] }), /same market/);
  });
  void it("hashes identity and amount only, never the label", () => {
    const a = basketExecutionArgs(legs);
    const b = basketExecutionArgs(legs.map((l) => ({ ...l, label: "renamed" })));
    assert.deepEqual(a, b);
  });
});

void describe("executeBasket", () => {
  void it("runs every leg, keeps going past a failure, and totals only the fills", async () => {
    const out = await executeBasket(legs, 100, (leg) =>
      leg.providerEventId === "402"
        ? Promise.reject(new Error("pool is thin"))
        : Promise.resolve({ txHash: "0xabc", received: "150.00 YES", effectivePriceBps: 4000 }),
    );
    assert.equal(out.filled, 1);
    assert.equal(out.failed, 1);
    assert.equal(out.placedUsdc, 60);
    assert.equal(out.requestedUsdc, 100);
    assert.equal(out.leftoverUsdc, 40);
    assert.equal(out.legs[1]?.error, "pool is thin");
    assert.equal(out.legs[0]?.txHash, "0xabc");
  });
  void it("reports the leftover against the budget when one was stated", () => {
    const fills = [
      {
        providerEventId: "401",
        outcomeIndex: 0 as const,
        label: null,
        amountUsdc: 96.4,
        status: "filled" as const,
        txHash: "0x1",
        received: "200 YES",
        effectivePriceBps: 4820,
        error: null,
      },
    ];
    const out = summarizeFills(fills, 100);
    assert.equal(out.placedUsdc, 96.4);
    assert.equal(out.leftoverUsdc, 3.6);
  });
});
