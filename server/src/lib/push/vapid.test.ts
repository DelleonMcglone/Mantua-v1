import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import {
  fromB64url,
  generateVapidKeys,
  pushAudience,
  VAPID_TOKEN_TTL_SECONDS,
  vapidAuthorization,
} from "./vapid.ts";

void describe("VAPID (RFC 8292, MX-004)", () => {
  void it("mints a key pair whose sizes match the env schema", () => {
    const keys = generateVapidKeys();
    assert.equal(fromB64url(keys.publicKey).length, 65);
    assert.equal(fromB64url(keys.publicKey)[0], 0x04, "uncompressed point");
    assert.equal(fromB64url(keys.privateKey).length, 32);
    assert.match(keys.publicKey, /^[A-Za-z0-9_-]{87}$/);
    assert.match(keys.privateKey, /^[A-Za-z0-9_-]{43}$/);
  });

  void it("signs an ES256 JWT for the endpoint's origin that the public key verifies", () => {
    const pair = generateVapidKeys();
    const keys = { ...pair, subject: "mailto:ops@mantua.ai" };
    const header = vapidAuthorization(
      keys,
      "https://fcm.googleapis.com/fcm/send/abc123?x=1",
      1_800_000_000,
    );
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    assert.ok(m, header);
    const [h, c, s] = m[1].split(".");
    assert.deepEqual(JSON.parse(fromB64url(h).toString()), { typ: "JWT", alg: "ES256" });
    assert.deepEqual(JSON.parse(fromB64url(c).toString()), {
      aud: "https://fcm.googleapis.com",
      exp: 1_800_000_000 + VAPID_TOKEN_TTL_SECONDS,
      sub: "mailto:ops@mantua.ai",
    });
    assert.equal(m[2], pair.publicKey);
    const point = fromB64url(pair.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
    });
    const signature = fromB64url(s);
    assert.equal(signature.length, 64, "raw r‖s");
    assert.ok(
      verify(
        "sha256",
        Buffer.from(`${h}.${c}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      ),
    );
  });

  void it("keeps the audience to the origin and the token under a day", () => {
    assert.equal(
      pushAudience("https://updates.push.services.mozilla.com/wpush/v2/x"),
      "https://updates.push.services.mozilla.com",
    );
    assert.ok(VAPID_TOKEN_TTL_SECONDS <= 24 * 3600);
  });
});
