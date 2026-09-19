/**
 * Task 071 (MX-004) — the activity spine is already the one place every
 * money path reports to (D-115), so it is the one place trade
 * confirmations, agent actions and settlements become pushes. Pure
 * mapping here; `notifyForActivity` is the best-effort hook
 * `recordActivity` calls after a successful insert.
 */
import type { DB } from "../../db/client.ts";
import type { Activity } from "../../db/schema/activity.ts";
import { logger } from "../logger.ts";
import { notifyUserOf } from "./dispatch.ts";
import type { PushEvent } from "./notifications.ts";
import { pushDeps } from "./push-store.ts";

type ActivityLike = Pick<
  Activity,
  "kind" | "actor" | "status" | "summary" | "txHash" | "refId" | "positionRef" | "data" | "id"
>;

export function pushEventForActivity(row: ActivityLike): PushEvent | null {
  if (row.status !== "completed") return null;
  const ref = row.txHash ?? row.positionRef ?? row.refId ?? row.id;
  switch (row.kind) {
    case "market_buy":
    case "market_sell":
      if (row.actor === "agent") {
        return { kind: "agent_action", action: "trade", summary: row.summary, ref };
      }
      return row.txHash
        ? { kind: "trade_confirmed", summary: row.summary, txHash: row.txHash }
        : null;
    case "hedge":
      return { kind: "agent_action", action: "hedge", summary: row.summary, ref };
    case "agent_recommendation":
      return { kind: "agent_action", action: "recommendation", summary: row.summary, ref };
    case "settlement": {
      const price = Number((row.data as { settlementPrice?: unknown } | null)?.settlementPrice);
      const won = Number.isFinite(price) ? price >= 1 : null;
      return { kind: "settlement", summary: row.summary, ref, won };
    }
    case "redeem":
      return { kind: "redeem", summary: row.summary, ref };
    default:
      return null;
  }
}

/** Fire-and-forget: a push must never fail the write that triggered it. */
export function notifyForActivity(db: DB, row: Activity): void {
  if (!row.userId) return;
  const event = pushEventForActivity(row);
  if (!event) return;
  const userId = row.userId;
  void notifyUserOf(pushDeps(db), userId, event).catch((err: unknown) => {
    logger.warn({ err, kind: row.kind }, "push: activity notification failed");
  });
}
