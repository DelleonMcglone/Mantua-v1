import assert from "node:assert/strict";
import test from "node:test";
import {
  ZERO_HASH_HOSTS,
  signZeroHashRequest,
  zeroHashRequest,
  type ZeroHashCredentials,
} from "./zerohash.ts";

// Fixed vector: secret is the sample base64 key shape from Zero Hash's
// authentication doc; expected value precomputed with node:crypto per the
// documented recipe — Base64(HMAC-SHA256(b64decode(secret),
// timestamp+method+path+body)).
const SECRET = "2mC4ZvVd4goRkuJm+rjr9byUiaUW1b6tVN4xy9QXNSE=";

test("zerohash signing matches the documented recipe (fixed vector)", () => {
  const signature = signZeroHashRequest({
    apiSecret: SECRET,
    timestamp: 1788998400,
    method: "POST",
    path: "/payments",
    body: '{"amount":"25.00"}',
  });
  assert.equal(signature, "m6O2GTfv+XPb2+/tcS5+lQ2kknFE4e34cGd2d41j5AY=");
});

test("signature changes with each signed component (order matters)", () => {
  const base = {
    apiSecret: SECRET,
    timestamp: 1788998400,
    method: "POST" as const,
    path: "/payments",
    body: "{}",
  };
  const reference = signZeroHashRequest(base);
  assert.notEqual(signZeroHashRequest({ ...base, timestamp: 1788998401 }), reference);
  assert.notEqual(signZeroHashRequest({ ...base, method: "GET" }), reference);
  assert.notEqual(signZeroHashRequest({ ...base, path: "/participants" }), reference);
  assert.notEqual(signZeroHashRequest({ ...base, body: '{"a":1}' }), reference);
});

const credentials: ZeroHashCredentials = {
  apiKey: "test-key",
  apiSecret: SECRET,
  passphrase: "test-pass",
  host: ZERO_HASH_HOSTS.sandbox,
};

function capturingFetch(status = 200, body: unknown = { message: { ok: true } }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { calls, fetchImpl };
}

test("zeroHashRequest sends the documented auth headers and compact body", async () => {
  const { calls, fetchImpl } = capturingFetch();
  await zeroHashRequest(
    "POST",
    "/payments",
    { amount: "25.00" },
    {
      credentials,
      fetchImpl,
      now: () => 1788998400,
    },
  );
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.cert.zerohash.com/payments");
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers["X-SCX-API-KEY"], "test-key");
  assert.equal(headers["X-SCX-TIMESTAMP"], "1788998400");
  assert.equal(headers["X-SCX-PASSPHRASE"], "test-pass");
  // Body is compact JSON and the signature covers exactly that string.
  assert.equal(call.init.body, '{"amount":"25.00"}');
  assert.equal(
    headers["X-SCX-SIGNED"],
    signZeroHashRequest({
      apiSecret: SECRET,
      timestamp: 1788998400,
      method: "POST",
      path: "/payments",
      body: '{"amount":"25.00"}',
    }),
  );
});

test("GET requests sign the literal {} and send no body", async () => {
  const { calls, fetchImpl } = capturingFetch();
  await zeroHashRequest("GET", "/payments/abc", undefined, {
    credentials,
    fetchImpl,
    now: () => 1788998400,
  });
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.init.body, undefined);
  const headers = call.init.headers as Record<string, string>;
  assert.equal(
    headers["X-SCX-SIGNED"],
    signZeroHashRequest({
      apiSecret: SECRET,
      timestamp: 1788998400,
      method: "GET",
      path: "/payments/abc",
      body: "{}",
    }),
  );
});

test("non-2xx responses raise ZeroHashError with status", async () => {
  const { fetchImpl } = capturingFetch(403, { error: "forbidden" });
  await assert.rejects(
    zeroHashRequest("POST", "/payments", {}, { credentials, fetchImpl }),
    (err: Error & { status?: number }) => {
      assert.match(err.message, /403/);
      assert.equal(err.status, 403);
      return true;
    },
  );
});
