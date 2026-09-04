import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { isTerminalFailureState, isTerminalSuccessState } from "../lib/circle/execute.ts";
import {
  applyFinalization,
  buildFinalizationPlan,
  claimExecutionFinalization,
  getExecutionByCircleTxId,
  recordWebhookEvent,
  warnUnknownExecution,
} from "../lib/circle/finalize.ts";
import { verifyCircleWebhookSignature } from "../lib/circle/webhook-verify.ts";
import type { TransactionState } from "@circle-fin/developer-controlled-wallets";
import { logger } from "../lib/logger.ts";

/**
 * C-015 — durable Circle webhook finalizer.
 *
 * Circle posts signed v2 notifications here when a transaction changes
 * state. This route is the DURABLE half of finalization: it resolves
 * executions whose sync poll timed out (frozen lambda, network partition)
 * and records failures for transactions whose poll never saw the revert.
 *
 * Exactly-once: delivery is deduped on `notificationId` (storage level),
 * and the poll/webhook race is settled by the conditional
 * `claimExecutionFinalization` UPDATE (ledger level). The winner applies
 * the finalization plan; the loser writes nothing.
 *
 * Mounted BEFORE `express.json()` so the ECDSA signature is verified over
 * the raw body bytes.
 */
export const circleWebhookRouter = Router();

/**
 * Circle v2 notification envelope:
 * { subscriptionId, notificationId, notificationType, notification, timestamp, version }
 * — `notification` is the changed resource (a wallet transaction object:
 * id, txHash, state, errorReason, …). Unknown fields are preserved.
 */
const notificationEnvelopeSchema = z.looseObject({
  notificationId: z.string().min(1),
  notificationType: z.string().optional(),
  // zod v4: looseObject preserves unknown fields (formerly passthrough).
  notification: z
    .looseObject({
      id: z.string().min(1).optional(),
      txHash: z.string().nullable().optional(),
      state: z.string().optional(),
      errorReason: z.string().nullable().optional(),
    })
    .optional(),
});

circleWebhookRouter.post(
  "/api/circle/webhook",
  // Raw body ONLY — the signature is over the exact bytes Circle sent.
  // Parsing and re-serializing the JSON would break verification.
  express.raw({ type: "*/*", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const rawBody: unknown = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      // Mounted before express.json() this never happens; fail closed anyway.
      res.status(400).json({ error: "Expected raw request body", code: "BAD_REQUEST" });
      return;
    }

    // 1. Signature — reject anything Circle did not sign. Fail closed.
    const signature = req.get("x-circle-signature");
    const keyId = req.get("x-circle-key-id");
    const verified = await verifyCircleWebhookSignature({
      rawBody,
      signature,
      keyId,
    });
    if (!verified) {
      logger.warn({ keyId: keyId ?? null }, "circle webhook: signature verification failed");
      res.status(401).json({ error: "Invalid webhook signature", code: "UNAUTHORIZED" });
      return;
    }

    // 2. Envelope.
    let parsed: z.infer<typeof notificationEnvelopeSchema>;
    try {
      parsed = notificationEnvelopeSchema.parse(JSON.parse(rawBody.toString("utf8")));
    } catch (err) {
      logger.warn({ err }, "circle webhook: malformed notification body");
      res.status(400).json({ error: "Malformed notification", code: "BAD_REQUEST" });
      return;
    }

    const notificationId = parsed.notificationId;
    const tx = parsed.notification;
    const circleTxId = tx?.id ?? null;
    const state = tx?.state ?? null;

    // 3. Storage-level dedup: redeliveries (same notificationId) are
    // acknowledged without side effects. Circle retries until we 200, so
    // an explicit ack is the correct response for a repeat delivery.
    const firstDelivery = await recordWebhookEvent({
      notificationId,
      ...(parsed.notificationType ? { eventType: parsed.notificationType } : {}),
      ...(circleTxId ? { circleTxId } : {}),
      payload: parsed,
    });
    if (!firstDelivery) {
      res.json({ ok: true, deduped: true });
      return;
    }

    // 4. Only terminal transaction states finalize anything; intermediate
    // states (SENT, STUCK, …) and non-transaction events are just acked.
    if (!circleTxId || !state) {
      res.json({ ok: true, ignored: "no transaction state in notification" });
      return;
    }
    if (
      !isTerminalSuccessState(state as TransactionState) &&
      !isTerminalFailureState(state as TransactionState)
    ) {
      res.json({ ok: true, ignored: `non-terminal state ${state}` });
      return;
    }

    // 5. Ledger lookup.
    const execution = await getExecutionByCircleTxId(circleTxId);
    if (!execution) {
      warnUnknownExecution(circleTxId, notificationId);
      res.json({ ok: true, ignored: "unknown execution" });
      return;
    }

    // 6. Exactly-once claim: flips pending → terminal. "lost" means the
    // poll (or a redelivery) already finalized — write nothing.
    const claim = await claimExecutionFinalization(
      circleTxId,
      "webhook",
      state as TransactionState,
      notificationId,
    );
    if (claim !== "won") {
      res.json({ ok: true, deduped: true });
      return;
    }

    // 7. Apply the finalization plan. On failure, 500 makes Circle retry —
    // the claim is already won, so retries hit the dedup ack. To keep the
    // retry path live for write failures we persist the plan application
    // outcome and return 500 (Circle redelivers the SAME notificationId,
    // which dedups at step 3 — so the retry cannot double-apply; instead,
    // a failed application is logged for ops follow-up).
    const plan = buildFinalizationPlan({
      kind: execution.kind,
      status: "pending",
      state: state as TransactionState,
      circleTxId,
      txHash: tx?.txHash ?? null,
      errorReason: tx?.errorReason ?? null,
      payload: execution.payload,
      source: "webhook",
      ...(execution.userId ? { userId: execution.userId } : {}),
    });
    if (!plan) {
      // Unbuildable plan (unknown kind / payload shape) — log loudly for
      // ops; acking stops the retry loop, which cannot fix a code bug.
      logger.error(
        { circleTxId, notificationId, kind: execution.kind, state },
        "circle webhook: finalization plan could not be built",
      );
      res.json({ ok: false, error: "finalization plan unbuildable" });
      return;
    }
    try {
      await applyFinalization(plan);
      logger.info(
        { circleTxId, notificationId, outcome: plan.outcome, effects: plan.effects.length },
        "circle webhook: execution finalized",
      );
      res.json({ ok: true, outcome: plan.outcome });
    } catch (err) {
      logger.error(
        { err, circleTxId, notificationId, outcome: plan.outcome },
        "circle webhook: finalization write failed",
      );
      res.status(500).json({ error: "Finalization write failed", code: "INTERNAL" });
    }
  },
);

// env.CIRCLE_WEBHOOK_KEY_ID is the subscription's signing key id — surfaced
// here so ops can match it against incoming X-Circle-Key-Id headers.
if (env.CIRCLE_WEBHOOK_KEY_ID) {
  logger.debug(
    { keyId: env.CIRCLE_WEBHOOK_KEY_ID },
    "circle webhook: notifications expected from this key id",
  );
}
