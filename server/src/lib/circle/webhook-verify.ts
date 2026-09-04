import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import { env } from "../../env.ts";
import { logger } from "../logger.ts";

/**
 * C-015 — Circle webhook signature verification.
 *
 * Circle signs every v2 notification with ECDSA-SHA256 over the RAW body
 * (re-serializing the JSON changes the byte order and breaks the
 * signature). The key that signed it is identified by the `X-Circle-Key-Id`
 * header; its public half is fetched from `/v2/notifications/publicKey/{id}`
 * with the regular API key and is static per key id, so it is cached here.
 * https://developers.circle.com/api-reference/verify-webhook-signatures
 */

export const CIRCLE_PUBLIC_KEY_URL = "https://api.circle.com/v2/notifications/publicKey";

const keyCache = new Map<string, KeyObject>();

/**
 * Fetch (and cache) the Circle public key for a notification key id.
 * Returns null when credentials are missing or the key cannot be fetched —
 * the caller must then reject the notification (fail closed).
 */
export async function circleWebhookPublicKey(keyId: string): Promise<KeyObject | null> {
  const cached = keyCache.get(keyId);
  if (cached) return cached;
  if (!env.CIRCLE_API_KEY) {
    logger.error("circle webhook: CIRCLE_API_KEY unset — cannot fetch notification public key");
    return null;
  }
  try {
    const res = await fetch(`${CIRCLE_PUBLIC_KEY_URL}/${keyId}`, {
      headers: { Authorization: `Bearer ${env.CIRCLE_API_KEY}` },
    });
    if (!res.ok) {
      logger.error({ status: res.status, keyId }, "circle webhook: public key fetch failed");
      return null;
    }
    const { data } = (await res.json()) as { data?: { publicKey?: string } };
    if (!data?.publicKey) {
      logger.error({ keyId }, "circle webhook: public key response missing data.publicKey");
      return null;
    }
    const key = createPublicKey({
      key: Buffer.from(data.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    keyCache.set(keyId, key);
    return key;
  } catch (err) {
    logger.error({ err, keyId }, "circle webhook: public key fetch threw");
    return null;
  }
}

/**
 * Verify a notification's `X-Circle-Signature` (base64 ECDSA-SHA256 over the
 * raw body) against the public key named by `X-Circle-Key-Id`. Missing
 * headers, an unfetchable key, or a bad signature all fail closed.
 */
export async function verifyCircleWebhookSignature(args: {
  rawBody: Buffer;
  signature: string | undefined;
  keyId: string | undefined;
}): Promise<boolean> {
  if (!args.signature || !args.keyId) return false;
  const key = await circleWebhookPublicKey(args.keyId);
  if (!key) return false;
  const verifier = createVerify("SHA256");
  verifier.update(args.rawBody);
  return verifier.verify(key, args.signature, "base64");
}

/**
 * Verify a raw signature against an already-resolved key — the testable
 * seam (signature math without the network fetch).
 */
export function verifySignatureWithKey(
  rawBody: Buffer,
  signature: string,
  key: KeyObject,
): boolean {
  const verifier = createVerify("SHA256");
  verifier.update(rawBody);
  return verifier.verify(key, signature, "base64");
}
