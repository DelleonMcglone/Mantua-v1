/**
 * Task 071 (MX-004) — RFC 8292 Voluntary Application Server Identification
 * for Web Push, on node:crypto alone. The application holds one P-256 key
 * pair; every push request carries a short-lived ES256 JWT signed with it
 * so the push service can hold a sender accountable. The private scalar
 * lives only in server env (`VAPID_PRIVATE_KEY`).
 */
import { createECDH, createPrivateKey, sign, type KeyObject } from "node:crypto";

export interface VapidKeys {
  /** base64url, the raw 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, the raw 32-byte private scalar. */
  privateKey: string;
  /** `mailto:` or `https:` contact for the push services (RFC 8292 §2.1). */
  subject: string;
}

/** RFC 8292 §2 caps `exp` at 24 h; half that leaves clock skew room. */
export const VAPID_TOKEN_TTL_SECONDS = 12 * 3600;

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromB64url(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

/** A fresh application key pair, for the one-time setup script. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** The private scalar as a signing key, with its public point recomputed. */
export function vapidSigningKey(privateKeyB64: string): KeyObject {
  const scalar = fromB64url(privateKeyB64);
  if (scalar.length !== 32) throw new Error("VAPID private key must be 32 bytes");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  const point = ecdh.getPublicKey();
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: privateKeyB64,
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
    },
  });
}

/** The `aud` claim: the push service's origin, nothing more (RFC 8292 §2). */
export function pushAudience(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}

/**
 * The `Authorization: vapid t=<jwt>, k=<key>` header value for one push
 * endpoint (RFC 8292 §3). `now` is a seam for the test.
 */
export function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: pushAudience(endpoint),
        exp: nowSeconds + VAPID_TOKEN_TTL_SECONDS,
        sub: keys.subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  // JWS ES256 wants the raw r‖s form, not DER.
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: vapidSigningKey(keys.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signingInput}.${b64url(signature)}, k=${keys.publicKey}`;
}
