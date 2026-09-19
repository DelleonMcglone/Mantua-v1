/**
 * Task 071 (MX-004) — the Drizzle-backed store behind the dispatcher, and
 * the production dependency bundle. Keys come from env; absent keys mean
 * `keys: null`, which the dispatcher treats as "push is off".
 */
import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { pushDeliveries, pushSubscriptions } from "../../db/schema/push.ts";
import { env } from "../../env.ts";
import type { DispatchDeps, PushStore } from "./dispatch.ts";
import { sendPush, type PushFetcher } from "./send.ts";
import type { VapidKeys } from "./vapid.ts";
import type { PushTopic } from "./topics.ts";

export function drizzlePushStore(db: DB): PushStore {
  return {
    async subscriptionsFor(userId) {
      return db
        .select({
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
          topics: pushSubscriptions.topics,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
    },
    async claimDelivery(userId, tag) {
      const rows = await db
        .insert(pushDeliveries)
        .values({ userId, tag })
        .onConflictDoNothing()
        .returning({ id: pushDeliveries.id });
      return rows.length > 0;
    },
    async remove(endpoint) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    },
  };
}

/** The deployment's application keys, or null when push is not configured. */
export function vapidKeysFromEnv(): VapidKeys | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null;
  return { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT };
}

const fetcher: PushFetcher = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
  return { status: res.status, headers: { get: (n) => res.headers.get(n) } };
};

export function pushDeps(db: DB): DispatchDeps {
  return {
    store: drizzlePushStore(db),
    keys: vapidKeysFromEnv(),
    send: (sub, message, keys) => sendPush(sub, message, keys, fetcher),
  };
}

/** One subscription row's topics, for the settings read. */
export async function readTopics(db: DB, userId: string, endpoint: string): Promise<unknown> {
  const rows = await db
    .select({ topics: pushSubscriptions.topics })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .limit(1);
  return rows.at(0)?.topics ?? null;
}

export interface SubscriptionRow {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  topics?: Partial<Record<PushTopic, boolean>> | undefined;
  userAgent?: string | undefined;
}

/** The three writes the subscribe routes make. */
export function subscriptionWriter(db: DB) {
  return {
    async upsert(row: SubscriptionRow): Promise<void> {
      await db
        .insert(pushSubscriptions)
        .values({
          userId: row.userId,
          endpoint: row.endpoint,
          p256dh: row.keys.p256dh,
          auth: row.keys.auth,
          topics: row.topics ?? {},
          userAgent: row.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: row.userId,
            p256dh: row.keys.p256dh,
            auth: row.keys.auth,
            ...(row.topics ? { topics: row.topics } : {}),
            userAgent: row.userAgent ?? null,
            lastSeenAt: new Date(),
          },
        });
    },
    async updateTopics(
      userId: string,
      endpoint: string,
      topics: Partial<Record<PushTopic, boolean>>,
    ): Promise<boolean> {
      const rows = await db
        .update(pushSubscriptions)
        .set({ topics, lastSeenAt: new Date() })
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
        .returning({ id: pushSubscriptions.id });
      return rows.length > 0;
    },
    async remove(userId: string, endpoint: string): Promise<void> {
      await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    },
  };
}
