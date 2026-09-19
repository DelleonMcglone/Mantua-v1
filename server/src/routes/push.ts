/**
 * Task 071 (MX-004) — Web Push subscriptions.
 *
 * GET    /api/push/config     — is push on, and the application public key.
 * POST   /api/push/subscribe  — register (or refresh) this browser's subscription.
 * PATCH  /api/push/topics     — change which topics this browser gets.
 * DELETE /api/push/subscribe  — forget this browser.
 * POST   /api/push/test       — send this user one test notification.
 *
 * A subscription is tied to the signed-in user; the endpoint URL is the
 * browser's identity. The push service keys are opaque to us — stored,
 * never decoded here — and the private application key never leaves env.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { dbFiatStore } from "../lib/fiat-store.ts";
import { logger } from "../lib/logger.ts";
import { notifyUserOf, type DispatchDeps } from "../lib/push/dispatch.ts";
import { isPushTopic, PUSH_TOPICS } from "../lib/push/topics.ts";
import { pushDeps, readTopics, subscriptionWriter } from "../lib/push/push-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";

export interface PushRouteDeps {
  ensureUser: (privyUserId: string) => Promise<string>;
  dispatch: () => DispatchDeps;
  upsert: (row: SubscriptionInput & { userId: string }) => Promise<void>;
  updateTopics: (userId: string, endpoint: string, topics: Topics) => Promise<boolean>;
  remove: (userId: string, endpoint: string) => Promise<void>;
  topics: (userId: string, endpoint: string) => Promise<unknown>;
}

const topicsSchema = z.record(z.string().refine(isPushTopic, "Unknown topic"), z.boolean());
type Topics = z.infer<typeof topicsSchema>;

const subscribeSchema = z.object({
  endpoint: z.url().startsWith("https://").max(2000),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  topics: topicsSchema.optional(),
  userAgent: z.string().max(200).optional(),
});
export type SubscriptionInput = z.infer<typeof subscribeSchema>;
const endpointSchema = z.object({ endpoint: z.url().max(2000) });
const topicsBody = endpointSchema.extend({ topics: topicsSchema });

export function createPushRouter(overrides: Partial<PushRouteDeps> = {}): Router {
  const deps: PushRouteDeps = {
    ensureUser: (id) => dbFiatStore.ensureUser(id),
    dispatch: () => pushDeps(db),
    ...subscriptionWriter(db),
    topics: (userId, endpoint) => readTopics(db, userId, endpoint),
    ...overrides,
  };
  const router = Router();
  const enabled = () => deps.dispatch().keys !== null;
  const bad = (res: Response) =>
    res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
  const off = (res: Response) =>
    res
      .status(503)
      .json({ error: "Notifications aren't available right now.", code: "PUSH_DISABLED" });

  router.get("/api/push/config", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      enabled: enabled(),
      publicKey: deps.dispatch().keys?.publicKey ?? null,
      topics: PUSH_TOPICS,
    });
  });

  router.post(
    "/api/push/subscribe",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      if (!enabled()) return off(res);
      const parsed = subscribeSchema.safeParse(req.body);
      if (!parsed.success) return bad(res);
      try {
        const userId = await deps.ensureUser(req.privyUserId ?? "");
        await deps.upsert({ ...parsed.data, userId });
        res.status(201).json({ ok: true, topics: await deps.topics(userId, parsed.data.endpoint) });
      } catch (err) {
        logger.error({ err }, "push: subscribe failed");
        res.status(500).json({ error: "Could not save the subscription", code: "INTERNAL" });
      }
    },
  );

  router.patch(
    "/api/push/topics",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const parsed = topicsBody.safeParse(req.body);
      if (!parsed.success) return bad(res);
      const userId = await deps.ensureUser(req.privyUserId ?? "");
      const found = await deps.updateTopics(userId, parsed.data.endpoint, parsed.data.topics);
      if (!found) return res.status(404).json({ error: "No such subscription", code: "NOT_FOUND" });
      res.json({ ok: true, topics: parsed.data.topics });
    },
  );

  router.delete(
    "/api/push/subscribe",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      const parsed = endpointSchema.safeParse(req.body);
      if (!parsed.success) return bad(res);
      await deps.remove(await deps.ensureUser(req.privyUserId ?? ""), parsed.data.endpoint);
      res.json({ ok: true });
    },
  );

  router.post(
    "/api/push/test",
    requireAuth,
    writeRateLimiter,
    async (req: Request, res: Response) => {
      if (!enabled()) return off(res);
      const userId = await deps.ensureUser(req.privyUserId ?? "");
      const result = await notifyUserOf(deps.dispatch(), userId, {
        kind: "test",
        nonce: String(Date.now()),
      });
      res.json(result);
    },
  );

  return router;
}

export const pushRouter = createPushRouter();
