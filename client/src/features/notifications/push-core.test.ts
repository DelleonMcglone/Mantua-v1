import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TOPICS_ON,
  PUSH_COPY,
  PUSH_TOPIC_LABELS,
  PUSH_TOPICS,
  pushState,
  subscriptionPayload,
  urlBase64ToUint8Array,
  type PushEnv,
} from "./push-core.ts";

const capable: PushEnv = {
  serverEnabled: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  permission: "default",
  ios: false,
  standalone: false,
  subscribed: false,
};

void describe("push state (MX-004)", () => {
  void it("walks the states a phone can be in", () => {
    assert.equal(pushState(capable), "off");
    assert.equal(pushState({ ...capable, subscribed: true }), "on");
    assert.equal(pushState({ ...capable, permission: "denied" }), "denied");
    assert.equal(pushState({ ...capable, serverEnabled: false }), "server-off");
    assert.equal(pushState({ ...capable, pushManager: false }), "unsupported");
    assert.equal(pushState({ ...capable, pushManager: false, ios: true }), "needs-install");
    assert.equal(pushState({ ...capable, ios: true, standalone: true }), "off");
    for (const s of Object.keys(PUSH_COPY))
      assert.ok(PUSH_COPY[s as keyof typeof PUSH_COPY].length > 0);
  });

  void it("decodes the application key and shapes the subscribe body", () => {
    const bytes = urlBase64ToUint8Array("AQID_-8");
    assert.deepEqual([...bytes], [1, 2, 3, 255, 239]);
    const payload = subscriptionPayload(
      { endpoint: "https://push.example/x", keys: { p256dh: "P", auth: "A" } },
      { games: false },
      "UA".repeat(200),
    );
    assert.deepEqual(payload, {
      endpoint: "https://push.example/x",
      keys: { p256dh: "P", auth: "A" },
      topics: { games: false },
      userAgent: "UA".repeat(100),
    });
    assert.equal(subscriptionPayload({ endpoint: "https://x" }, {}, "ua"), null);
    assert.deepEqual(Object.keys(ALL_TOPICS_ON), [...PUSH_TOPICS]);
    for (const t of PUSH_TOPICS) assert.ok(PUSH_TOPIC_LABELS[t].label);
  });
});
