import express, { Router, type Request, type Response } from "express";
import { env } from "../env.ts";
import { applyFiatTransition } from "../lib/fiat-rails.ts";
import { dbFiatStore } from "../lib/fiat-store.ts";
import {
  ZH_SIGNATURE_HEADER,
  ZH_TIMESTAMP_HEADER,
  mapZhEventToTransition,
  verifyZhWebhookSignature,
  zhWebhookEnvelopeSchema,
  zhWebhookEventId,
} from "../lib/fiat-webhook.ts";
import { logger } from "../lib/logger.ts";

/**
 * F-004 — Zero Hash webhook receiver.
 *
 * Verify-then-process, like the Circle webhook finalizer (C-015):
 *
 *   1. signature over the RAW body bytes — unsigned/unverifiable → 401.
 *      Fails closed when no webhook secret is configured (503): we never
 *      process an unverified provider event.
 *   2. storage-level dedupe on the provider event id
 *      (`fiat_webhook_events` unique) — redelivery is an ack, no effects.
 *   3. map the event to a one-way state transition (lib/fiat-webhook.ts)
 *      and apply it through the single transition seam, which also writes
 *      the audit row. A transition that doesn't apply (already terminal,
 *      out-of-order delivery) is acked without effect — the machine is
 *      one-way by construction.
 *
 * Mounted BEFORE express.json() so signatures verify over exact bytes.
 *
 * Plaid webhooks: not required for the processor-token flow (the access
 * token is transient, so there is no long-lived item to maintain). If
 * Identity/Balance products later need item webhooks, add a sibling route
 * with Plaid's JWT verification — noted in the 036 task doc.
 */
export const fiatWebhookRouter = Router();

fiatWebhookRouter.post(
  "/api/fiat/webhook",
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const rawBody: unknown = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: "Expected raw request body", code: "BAD_REQUEST" });
      return;
    }

    // 1. Signature — fail closed without a configured secret.
    const secret = env.ZERO_HASH_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Webhook verification unconfigured", code: "UNCONFIGURED" });
      return;
    }
    const verified = verifyZhWebhookSignature({
      rawBody,
      signature: req.get(ZH_SIGNATURE_HEADER),
      timestamp: req.get(ZH_TIMESTAMP_HEADER),
      secret,
    });
    if (!verified) {
      logger.warn("fiat webhook: signature verification failed");
      res.status(401).json({ error: "Invalid webhook signature", code: "UNAUTHORIZED" });
      return;
    }

    // 2. Envelope.
    let event;
    try {
      event = zhWebhookEnvelopeSchema.parse(JSON.parse(rawBody.toString("utf8")));
    } catch (err) {
      logger.warn({ err }, "fiat webhook: malformed body");
      res.status(400).json({ error: "Malformed notification", code: "BAD_REQUEST" });
      return;
    }

    // 3. Idempotency: first delivery wins at the storage layer.
    const eventId = zhWebhookEventId(event, rawBody);
    const transition = mapZhEventToTransition(event);
    const transfer = transition
      ? await dbFiatStore.getTransferByZhId(transition.providerRef)
      : null;
    const firstDelivery = await dbFiatStore.recordWebhookEvent({
      provider: "zerohash",
      eventId,
      eventType: event.event_type ?? event.type,
      transferId: transfer?.id,
      payload: event,
    });
    if (!firstDelivery) {
      res.json({ ok: true, deduped: true });
      return;
    }

    if (!transition) {
      res.json({ ok: true, ignored: "no transfer state in event" });
      return;
    }
    if (!transfer) {
      logger.warn({ providerRef: transition.providerRef }, "fiat webhook: unknown transfer ref");
      res.json({ ok: true, ignored: "unknown transfer" });
      return;
    }

    // 4. One-way transition (+ audit) through the single seam. `null`
    //    means the transition was illegal from the current status — for a
    //    webhook that is an out-of-order or repeat delivery, which the
    //    one-way machine absorbs silently.
    const applied = await applyFiatTransition({
      transferId: transfer.id,
      to: transition.to,
      patch: {
        providerStatus: transition.providerStatus,
        ...(transition.failureReason ? { failureReason: transition.failureReason } : {}),
        ...(transition.recoveryAction ? { recoveryAction: transition.recoveryAction } : {}),
      },
      source: "webhook",
    });
    res.json({ ok: true, applied: applied !== null, status: transition.to });
  },
);
