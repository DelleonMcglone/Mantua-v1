import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { pushEventForActivity } = await import("./activity-bridge.ts");

const base = {
  id: "row-1",
  status: "completed",
  summary: "bought 200.00 YES for $100.00",
  txHash: "0xabc",
  refId: null,
  positionRef: null,
  data: {},
};

void describe("activity → push bridge (MX-004)", () => {
  void it("a user's verified trade is a confirmation; an agent's is an agent action", () => {
    assert.deepEqual(pushEventForActivity({ ...base, kind: "market_buy", actor: "user" }), {
      kind: "trade_confirmed",
      summary: base.summary,
      txHash: "0xabc",
    });
    assert.deepEqual(pushEventForActivity({ ...base, kind: "market_sell", actor: "agent" }), {
      kind: "agent_action",
      action: "trade",
      summary: base.summary,
      ref: "0xabc",
    });
    assert.equal(
      pushEventForActivity({ ...base, kind: "hedge", actor: "agent" })?.kind,
      "agent_action",
    );
  });

  void it("settlement reads the win from the settlement price; pending rows and other kinds are silent", () => {
    const won = pushEventForActivity({
      ...base,
      kind: "settlement",
      actor: "system",
      positionRef: "p1",
      data: { settlementPrice: "1.00000" },
    });
    assert.deepEqual(won, { kind: "settlement", summary: base.summary, ref: "0xabc", won: true });
    const lost = pushEventForActivity({
      ...base,
      kind: "settlement",
      actor: "system",
      txHash: null,
      positionRef: "p2",
      data: { settlementPrice: "0.00000" },
    });
    assert.equal(lost?.kind === "settlement" && lost.won, false);
    assert.equal(lost?.kind === "settlement" && lost.ref, "p2");
    assert.equal(
      pushEventForActivity({ ...base, kind: "market_buy", actor: "user", status: "pending" }),
      null,
    );
    assert.equal(pushEventForActivity({ ...base, kind: "deposit", actor: "user" }), null);
    assert.equal(pushEventForActivity({ ...base, kind: "agent_research", actor: "agent" }), null);
    assert.equal(
      pushEventForActivity({ ...base, kind: "market_buy", actor: "user", txHash: null }),
      null,
    );
  });
});
