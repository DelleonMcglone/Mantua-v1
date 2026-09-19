/**
 * Task 071 (MX-004) — one push to one browser. Encrypts the message for
 * the subscription (RFC 8291), signs the request (RFC 8292) and POSTs it
 * to the push service behind a `fetch` seam, mapping every answer to one
 * of five outcomes. A `gone` subscription is the caller's cue to delete
 * it; nothing here retries.
 */
import { encryptForPush } from "./encrypt.ts";
import type { PushMessage } from "./notifications.ts";
import { fromB64url, vapidAuthorization, type VapidKeys } from "./vapid.ts";

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendOutcome =
  | { status: "sent" }
  | { status: "gone" }
  | { status: "rate_limited"; retryAfterSeconds: number | null }
  | { status: "rejected"; httpStatus: number }
  | { status: "failed"; reason: string };

export interface PushResponse {
  status: number;
  headers: { get(name: string): string | null };
}

export type PushFetcher = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: Uint8Array },
) => Promise<PushResponse>;

/** What the service worker reads (client/public/sw.js). */
export function payloadFor(message: PushMessage): string {
  return JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.tag,
    topic: message.topic,
  });
}

/** RFC 8030 §5.4: a topic is at most 32 URL-safe characters. */
export function pushTopicHeader(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
}

export async function sendPush(
  subscription: SubscriptionKeys,
  message: PushMessage,
  keys: VapidKeys,
  fetcher: PushFetcher,
): Promise<SendOutcome> {
  let body: Uint8Array;
  let authorization: string;
  try {
    body = encryptForPush({
      plaintext: Buffer.from(payloadFor(message), "utf8"),
      receiverPublicKey: fromB64url(subscription.p256dh),
      authSecret: fromB64url(subscription.auth),
    });
    authorization = vapidAuthorization(keys, subscription.endpoint);
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "encrypt failed" };
  }
  try {
    const res = await fetcher(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        TTL: String(message.ttlSeconds),
        Urgency: message.urgency,
        Topic: pushTopicHeader(message.tag),
      },
      body,
    });
    return outcomeFor(res);
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : "transport failed" };
  }
}

export function outcomeFor(res: PushResponse): SendOutcome {
  if (res.status >= 200 && res.status < 300) return { status: "sent" };
  if (res.status === 404 || res.status === 410) return { status: "gone" };
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    return { status: "rate_limited", retryAfterSeconds: Number.isFinite(after) ? after : null };
  }
  if (res.status >= 400 && res.status < 500) return { status: "rejected", httpStatus: res.status };
  return { status: "failed", reason: `push service answered ${String(res.status)}` };
}
