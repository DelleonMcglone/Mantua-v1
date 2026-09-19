/**
 * Task 071 (MX-004) — the live-sync tick's two push passes: game events
 * for everyone holding a position in a game that just kicked off or went
 * final, and position alerts for every held side that moved a step from
 * entry. Nothing runs when push is not configured, so the tick costs no
 * extra queries on such deployments.
 */
import type { DB } from "../../db/client.ts";
import type { ProviderEvent } from "../sports/provider.ts";
import { notifyUserOf, type DispatchDeps } from "./dispatch.ts";
import {
  gameEventFor,
  gameTransitions,
  positionAlerts,
  type StatusSnapshot,
} from "./live-alerts.ts";
import { heldPositions, holdersOf, latestPoolPrices } from "./live-alerts-db.ts";

export async function runGameEventAlerts(
  db: DB,
  deps: DispatchDeps,
  league: string,
  before: readonly StatusSnapshot[],
  after: readonly ProviderEvent[],
): Promise<number> {
  if (!deps.keys) return 0;
  const transitions = gameTransitions(before, after);
  if (transitions.length === 0) return 0;
  const holders = await holdersOf(
    db,
    transitions.map((t) => t.event.providerEventId),
  );
  let sent = 0;
  for (const t of transitions) {
    for (const userId of holders.get(t.event.providerEventId) ?? []) {
      const r = await notifyUserOf(deps, userId, gameEventFor(t, league));
      sent += r.sent;
    }
  }
  return sent;
}

export async function runPositionAlerts(db: DB, deps: DispatchDeps): Promise<number> {
  if (!deps.keys) return 0;
  const held = await heldPositions(db);
  if (held.length === 0) return 0;
  const prices = await latestPoolPrices(db, [...new Set(held.map((h) => h.marketId))]);
  let sent = 0;
  for (const alert of positionAlerts(held, prices)) {
    sent += (await notifyUserOf(deps, alert.userId, alert.event)).sent;
  }
  return sent;
}
