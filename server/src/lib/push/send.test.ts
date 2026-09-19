import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { messageFor } from "./notifications.ts";
import { outcomeFor, payloadFor, pushTopicHeader, sendPush, type PushFetcher } from "./send.ts";
import { generateVapidKeys } from "./vapid.ts";

const keys = { ...generateVapidKeys(), subject: "mailto:ops@mantua.ai" };
function subscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/token",
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: Buffer.alloc(16, 3).toString("base64url"),
  };
}
const message = messageFor({
  kind: "trade_confirmed",
  summary: "bought 1 YES for $1",
  txHash: "0x1",
});

void describe("push send (MX-004)", () => {
  void it("posts an encrypted, VAPID-signed request with the RFC 8030 headers", async () => {
    const calls: Parameters<PushFetcher>[] = [];
    const fetcher: PushFetcher = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve({ status: 201, headers: { get: () => null } });
    };
    const out = await sendPush(subscription(), message, keys, fetcher);
    assert.deepEqual(out, { status: "sent" });
    const [url, init] = calls[0];
    assert.equal(url, "https://fcm.googleapis.com/fcm/send/token");
    assert.equal(init.headers["Content-Encoding"], "aes128gcm");
    assert.equal(init.headers["TTL"], "3600");
    assert.equal(init.headers["Urgency"], "high");
    assert.equal(init.headers["Topic"], "trade_0x1");
    assert.match(init.headers["Authorization"], /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
    assert.equal(init.headers["Content-Length"], String(init.body.length));
    // The service sees ciphertext: the title never appears in the body.
    assert.ok(!Buffer.from(init.body).toString("latin1").includes("Trade executed"));
    assert.deepEqual(JSON.parse(payloadFor(message)), {
      title: "Trade executed",
      body: "You bought 1 YES for $1.",
      url: "/?open=profile",
      tag: "trade:0x1",
      topic: "trades",
    });
  });

  void it("maps every push-service answer to one outcome", () => {
    const h = (retry: string | null) => ({ get: () => retry });
    assert.deepEqual(outcomeFor({ status: 200, headers: h(null) }), { status: "sent" });
    assert.deepEqual(outcomeFor({ status: 410, headers: h(null) }), { status: "gone" });
    assert.deepEqual(outcomeFor({ status: 404, headers: h(null) }), { status: "gone" });
    assert.deepEqual(outcomeFor({ status: 429, headers: h("30") }), {
      status: "rate_limited",
      retryAfterSeconds: 30,
    });
    assert.deepEqual(outcomeFor({ status: 413, headers: h(null) }), {
      status: "rejected",
      httpStatus: 413,
    });
    assert.equal(outcomeFor({ status: 502, headers: h(null) }).status, "failed");
  });

  void it("a broken subscription key or a dead transport is a failure, never a throw", async () => {
    const bad = { ...subscription(), p256dh: "AAAA" };
    const never: PushFetcher = () => Promise.reject(new Error("unreachable"));
    assert.equal((await sendPush(bad, message, keys, never)).status, "failed");
    assert.equal((await sendPush(subscription(), message, keys, never)).status, "failed");
    assert.equal(pushTopicHeader("position:0xabc/def:up1"), "position_0xabc_def_up1");
    assert.ok(pushTopicHeader("x".repeat(80)).length <= 32);
  });
});
