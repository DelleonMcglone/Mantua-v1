import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FiatRecoveryAction, FiatTransferStatus } from "./fiat-transfers.ts";

/**
 * F-004 — Zero Hash webhook verification + event mapping (pure; the
 * express route in routes/fiat-webhook.ts wires these to storage).
 *
 * Verification implements Zero Hash's documented HMAC scheme
 * (https://docs.zerohash.com/reference/webhook-security, fetched
 * 2026-09-05):
 *
 *   headers:   x-zh-hook-signature (hex HMAC) + x-zh-hook-timestamp
 *   signature: to_hex( HMAC-SHA256( rawBody + timestamp, platform secret ) )
 *   replay:    timestamp must be within ±5 minutes of server time
 *
 * Verify-then-process: unsigned or unverifiable deliveries are rejected
 * BEFORE any parsing or storage. (Zero Hash also offers an RSA variant,
 * `x-zh-hook-rsa-signature` — adopt it here if commercial onboarding
 * provisions an RSA key instead of an HMAC secret.)
 */

export const ZH_SIGNATURE_HEADER = "x-zh-hook-signature";
export const ZH_TIMESTAMP_HEADER = "x-zh-hook-timestamp";
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function computeZhWebhookSignature(
  rawBody: Buffer,
  timestamp: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(Buffer.concat([rawBody, Buffer.from(timestamp, "utf8")]))
    .digest("hex");
}

export function verifyZhWebhookSignature(params: {
  rawBody: Buffer;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string;
  nowMs?: number;
}): boolean {
  if (!params.signature || !params.timestamp) return false;
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts)) return false;
  // Timestamps are unix seconds; tolerate ms-encoded ones defensively.
  const tsMs = ts > 10_000_000_000 ? ts : ts * 1000;
  const now = params.nowMs ?? Date.now();
  if (Math.abs(now - tsMs) > REPLAY_WINDOW_MS) return false;
  const expected = computeZhWebhookSignature(params.rawBody, params.timestamp, params.secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(params.signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Loose envelope for Zero Hash notifications: an event id, a type, and the
 * changed resource. Field names follow the payment/withdrawal objects in
 * the public reference; unknown fields are preserved for the stored payload.
 */
export const zhWebhookEnvelopeSchema = z.looseObject({
  id: z.string().min(1).optional(),
  event_id: z.string().min(1).optional(),
  event_type: z.string().optional(),
  type: z.string().optional(),
  payment_id: z.string().optional(),
  withdrawal_request_id: z.string().optional(),
  status: z.string().optional(),
  reason: z.string().nullable().optional(),
  data: z
    .looseObject({
      payment_id: z.string().optional(),
      withdrawal_request_id: z.string().optional(),
      status: z.string().optional(),
      reason: z.string().nullable().optional(),
    })
    .optional(),
});
export type ZhWebhookEnvelope = z.infer<typeof zhWebhookEnvelopeSchema>;

export interface FiatWebhookTransition {
  /** Provider reference joining the event to a fiat_transfers row. */
  providerRef: string;
  to: FiatTransferStatus;
  providerStatus: string;
  failureReason?: string;
  recoveryAction?: FiatRecoveryAction;
}

/**
 * Map a provider event to a state-machine transition. Returns null for
 * events that carry no transfer state (participant updates, heartbeats).
 *
 * Provider status vocabulary (payments/withdrawals): pending/submitted →
 * processing; posted/settled/confirmed → complete; returned/failed/
 * rejected → failed (returned ACH ⇒ retry; rejected ⇒ contact support);
 * canceled/cancelled → canceled.
 */
export function mapZhEventToTransition(event: ZhWebhookEnvelope): FiatWebhookTransition | null {
  const providerRef =
    event.payment_id ??
    event.withdrawal_request_id ??
    event.data?.payment_id ??
    event.data?.withdrawal_request_id;
  const status = (event.status ?? event.data?.status)?.toLowerCase();
  if (!providerRef || !status) return null;

  switch (status) {
    case "pending":
    case "submitted":
    case "processing":
      return { providerRef, to: "processing", providerStatus: status };
    case "posted":
    case "settled":
    case "confirmed":
    case "complete":
    case "completed":
      return { providerRef, to: "complete", providerStatus: status };
    case "returned":
      return {
        providerRef,
        to: "failed",
        providerStatus: status,
        failureReason: "Your bank returned the transfer.",
        recoveryAction: "retry",
      };
    case "failed":
    case "rejected":
      return {
        providerRef,
        to: "failed",
        providerStatus: status,
        failureReason: "The transfer didn’t go through.",
        recoveryAction: "contact_support",
      };
    case "canceled":
    case "cancelled":
      return { providerRef, to: "canceled", providerStatus: status };
    default:
      return null;
  }
}

export function zhWebhookEventId(event: ZhWebhookEnvelope, rawBody: Buffer): string {
  // Prefer the provider's event id; fall back to a digest of the body so
  // dedupe still holds for events delivered without one.
  return (
    event.event_id ??
    event.id ??
    createHmac("sha256", "zh-event").update(rawBody).digest("hex").slice(0, 64)
  );
}
