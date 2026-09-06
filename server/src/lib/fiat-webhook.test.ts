import assert from "node:assert/strict";
import test from "node:test";
import {
  computeZhWebhookSignature,
  mapZhEventToTransition,
  verifyZhWebhookSignature,
  zhWebhookEnvelopeSchema,
  zhWebhookEventId,
} from "./fiat-webhook.ts";

const RAW = Buffer.from('{"payment_id":"pay_1","status":"settled"}', "utf8");
const SECRET = "whsec_test";
const TS = "1788998400";
const NOW_MS = 1788998400 * 1000;

test("webhook signature matches the documented hex(hmac(body+timestamp)) form", () => {
  // Precomputed with node:crypto per docs.zerohash.com/reference/webhook-security.
  assert.equal(
    computeZhWebhookSignature(RAW, TS, SECRET),
    "bf58f04ee9a3e6f68fa7497890ad0aeafa13acb5594235136239ddd671a7ec90",
  );
});

test("verification accepts a valid signature inside the replay window", () => {
  const signature = computeZhWebhookSignature(RAW, TS, SECRET);
  assert.equal(
    verifyZhWebhookSignature({
      rawBody: RAW,
      signature,
      timestamp: TS,
      secret: SECRET,
      nowMs: NOW_MS,
    }),
    true,
  );
});

test("verification rejects missing, wrong, tampered, and stale signatures", () => {
  const signature = computeZhWebhookSignature(RAW, TS, SECRET);
  const base = { rawBody: RAW, signature, timestamp: TS, secret: SECRET, nowMs: NOW_MS };
  assert.equal(verifyZhWebhookSignature({ ...base, signature: undefined }), false);
  assert.equal(verifyZhWebhookSignature({ ...base, timestamp: undefined }), false);
  const tampered = (signature[0] === "0" ? "1" : "0") + signature.slice(1);
  assert.equal(verifyZhWebhookSignature({ ...base, signature: tampered }), false);
  assert.equal(verifyZhWebhookSignature({ ...base, secret: "other-secret" }), false);
  assert.equal(verifyZhWebhookSignature({ ...base, rawBody: Buffer.from("{}", "utf8") }), false);
  // Replay: same signature, but delivered 6 minutes later.
  assert.equal(verifyZhWebhookSignature({ ...base, nowMs: NOW_MS + 6 * 60 * 1000 }), false);
});

test("event mapping covers settle, return, reject, and cancel", () => {
  const settled = mapZhEventToTransition(
    zhWebhookEnvelopeSchema.parse({ payment_id: "pay_1", status: "settled" }),
  );
  assert.deepEqual(settled, { providerRef: "pay_1", to: "complete", providerStatus: "settled" });

  const returned = mapZhEventToTransition(
    zhWebhookEnvelopeSchema.parse({ data: { payment_id: "pay_2", status: "returned" } }),
  );
  assert.ok(returned);
  assert.equal(returned.to, "failed");
  assert.equal(returned.recoveryAction, "retry");

  const rejected = mapZhEventToTransition(
    zhWebhookEnvelopeSchema.parse({ payment_id: "pay_3", status: "rejected" }),
  );
  assert.ok(rejected);
  assert.equal(rejected.to, "failed");
  assert.equal(rejected.recoveryAction, "contact_support");

  const canceled = mapZhEventToTransition(
    zhWebhookEnvelopeSchema.parse({ withdrawal_request_id: "wd_1", status: "canceled" }),
  );
  assert.equal(canceled?.to, "canceled");

  // Events with no transfer state map to nothing.
  assert.equal(mapZhEventToTransition(zhWebhookEnvelopeSchema.parse({ status: "settled" })), null);
  assert.equal(
    mapZhEventToTransition(zhWebhookEnvelopeSchema.parse({ payment_id: "p", status: "weird" })),
    null,
  );
});

test("event id prefers provider ids and falls back to a body digest", () => {
  assert.equal(
    zhWebhookEventId(zhWebhookEnvelopeSchema.parse({ event_id: "evt_1" }), RAW),
    "evt_1",
  );
  assert.equal(zhWebhookEventId(zhWebhookEnvelopeSchema.parse({ id: "evt_2" }), RAW), "evt_2");
  const a = zhWebhookEventId(zhWebhookEnvelopeSchema.parse({}), RAW);
  const b = zhWebhookEventId(zhWebhookEnvelopeSchema.parse({}), RAW);
  const c = zhWebhookEventId(zhWebhookEnvelopeSchema.parse({}), Buffer.from("{}", "utf8"));
  assert.equal(a, b); // deterministic → dedupes redelivery
  assert.notEqual(a, c);
});
