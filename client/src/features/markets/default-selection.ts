/**
 * The league page's default selection: the deep-linked game or team, else
 * the first tradeable game with a live pool price, else the first
 * tradeable game, else the first game — so the ticket is always populated.
 * Pure; `LeaguePage.tsx` calls it.
 */
import { isTradableStatus } from "./market-trade-core.ts";
import { resolveTeamSelection } from "./team-select.ts";
import type { SlateEvent } from "./use-slate.ts";

export interface Selection {
  event: SlateEvent;
  outcomeIndex: 0 | 1;
}

export interface DeepLink {
  initialEventId?: string | undefined;
  initialSide?: 0 | 1 | undefined;
  initialTeam?: string | undefined;
}

export function defaultSelection(events: readonly SlateEvent[], link: DeepLink): Selection | null {
  const linked = link.initialEventId
    ? events.find((e) => e.providerEventId === link.initialEventId)
    : undefined;
  if (linked) return { event: linked, outcomeIndex: link.initialSide ?? 0 };
  const byTeam = link.initialTeam ? resolveTeamSelection(events, link.initialTeam) : null;
  const teamEvent = byTeam ? events.find((e) => e.providerEventId === byTeam.eventId) : undefined;
  if (byTeam && teamEvent) return { event: teamEvent, outcomeIndex: byTeam.outcomeIndex };
  const first =
    events.find((e) => e.liveOdds && isTradableStatus(e.status)) ??
    events.find((e) => isTradableStatus(e.status)) ??
    events.at(0);
  return first ? { event: first, outcomeIndex: 0 } : null;
}
