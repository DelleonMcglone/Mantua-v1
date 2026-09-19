/**
 * Task 071 (MX-004) — deliver one message to one user, exactly once.
 *
 * The delivery log is claimed BEFORE anything is sent, so two instances
 * reacting to the same fill (or a cron tick re-run) race for one row and
 * only the winner sends. A subscription the push service reports gone is
 * removed on the spot. Push being unconfigured is a normal state, not an
 * error: the dispatcher answers `disabled` and the caller carries on.
 */
import { logger } from "../logger.ts";
import { messageFor, type PushEvent, type PushMessage } from "./notifications.ts";
import { topicEnabled } from "./topics.ts";
import type { SendOutcome, SubscriptionKeys } from "./send.ts";
import type { VapidKeys } from "./vapid.ts";

export interface StoredSubscription extends SubscriptionKeys {
  topics: unknown;
}

export interface PushStore {
  subscriptionsFor(userId: string): Promise<StoredSubscription[]>;
  /** True when this (user, tag) was not yet claimed — the caller may send. */
  claimDelivery(userId: string, tag: string): Promise<boolean>;
  remove(endpoint: string): Promise<void>;
}

export interface DispatchDeps {
  store: PushStore;
  /** Null when the deployment has no VAPID keys — push is off. */
  keys: VapidKeys | null;
  send: (sub: SubscriptionKeys, message: PushMessage, keys: VapidKeys) => Promise<SendOutcome>;
}

export interface DispatchResult {
  outcome: "sent" | "duplicate" | "no_subscriptions" | "muted" | "disabled";
  sent: number;
  gone: number;
  failed: number;
}

export async function notifyUser(
  deps: DispatchDeps,
  userId: string,
  message: PushMessage,
): Promise<DispatchResult> {
  const zero = { sent: 0, gone: 0, failed: 0 };
  if (!deps.keys) return { outcome: "disabled", ...zero };
  const all = await deps.store.subscriptionsFor(userId);
  if (all.length === 0) return { outcome: "no_subscriptions", ...zero };
  const subs = all.filter((s) => topicEnabled(s.topics, message.topic));
  if (subs.length === 0) return { outcome: "muted", ...zero };
  if (!(await deps.store.claimDelivery(userId, message.tag))) {
    return { outcome: "duplicate", ...zero };
  }
  const result: DispatchResult = { outcome: "sent", ...zero };
  for (const sub of subs) {
    const out = await deps.send(sub, message, deps.keys);
    if (out.status === "sent") result.sent += 1;
    else if (out.status === "gone") {
      result.gone += 1;
      await deps.store.remove(sub.endpoint).catch(() => undefined);
    } else {
      result.failed += 1;
      logger.warn({ outcome: out, tag: message.tag }, "push: delivery failed");
    }
  }
  return result;
}

/** The event form, for callers that hold an event rather than a message. */
export function notifyUserOf(
  deps: DispatchDeps,
  userId: string,
  event: PushEvent,
): Promise<DispatchResult> {
  return notifyUser(deps, userId, messageFor(event));
}
