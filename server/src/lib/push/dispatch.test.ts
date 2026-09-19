import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { notifyUser, notifyUserOf } = await import("./dispatch.ts");
type DispatchDeps = import("./dispatch.ts").DispatchDeps;
type StoredSubscription = import("./dispatch.ts").StoredSubscription;
type SendOutcome = import("./send.ts").SendOutcome;
const { messageFor } = await import("./notifications.ts");

const KEYS = { publicKey: "p", privateKey: "s", subject: "mailto:x@y.z" };

function fakeDeps(subs: StoredSubscription[], answer: (endpoint: string) => SendOutcome) {
  const claimed = new Set<string>();
  const sent: string[] = [];
  const removed: string[] = [];
  const deps: DispatchDeps = {
    keys: KEYS,
    store: {
      subscriptionsFor: () => Promise.resolve(subs),
      claimDelivery: (userId, tag) => {
        const k = `${userId}|${tag}`;
        if (claimed.has(k)) return Promise.resolve(false);
        claimed.add(k);
        return Promise.resolve(true);
      },
      remove: (endpoint) => {
        removed.push(endpoint);
        return Promise.resolve();
      },
    },
    send: (sub) => {
      sent.push(sub.endpoint);
      return Promise.resolve(answer(sub.endpoint));
    },
  };
  return { deps, sent, removed };
}
const sub = (endpoint: string, topics: unknown = {}): StoredSubscription => ({
  endpoint,
  p256dh: "k",
  auth: "a",
  topics,
});
const trade = messageFor({ kind: "trade_confirmed", summary: "bought", txHash: "0x1" });

void describe("push dispatch (MX-004)", () => {
  void it("sends once per (user, tag) across every subscribed browser", async () => {
    const { deps, sent } = fakeDeps([sub("phone"), sub("laptop")], () => ({ status: "sent" }));
    const first = await notifyUser(deps, "u1", trade);
    assert.deepEqual(first, { outcome: "sent", sent: 2, gone: 0, failed: 0 });
    const again = await notifyUser(deps, "u1", trade);
    assert.equal(again.outcome, "duplicate");
    assert.deepEqual(sent, ["phone", "laptop"], "the replay sent nothing");
    const other = await notifyUser(deps, "u2", trade);
    assert.equal(other.outcome, "sent", "another user's same tag is its own delivery");
  });

  void it("respects the topic opt-out and removes a subscription the service reports gone", async () => {
    const { deps, removed } = fakeDeps([sub("phone", { trades: false }), sub("old")], (e) =>
      e === "old" ? { status: "gone" } : { status: "sent" },
    );
    const r = await notifyUser(deps, "u1", trade);
    assert.deepEqual(r, { outcome: "sent", sent: 0, gone: 1, failed: 0 });
    assert.deepEqual(removed, ["old"]);
    const muted = fakeDeps([sub("phone", { trades: false })], () => ({ status: "sent" }));
    assert.equal((await notifyUser(muted.deps, "u1", trade)).outcome, "muted");
  });

  void it("is a no-op without keys or subscriptions, and never claims a delivery it will not send", async () => {
    const none = fakeDeps([], () => ({ status: "sent" }));
    assert.equal((await notifyUser(none.deps, "u1", trade)).outcome, "no_subscriptions");
    const off = fakeDeps([sub("phone")], () => ({ status: "sent" }));
    off.deps.keys = null;
    assert.equal(
      (await notifyUserOf(off.deps, "u1", { kind: "test", nonce: "1" })).outcome,
      "disabled",
    );
    assert.equal(off.sent.length, 0);
    const failing = fakeDeps([sub("phone")], () => ({ status: "failed", reason: "502" }));
    assert.deepEqual(await notifyUser(failing.deps, "u1", trade), {
      outcome: "sent",
      sent: 0,
      gone: 0,
      failed: 1,
    });
  });
});
