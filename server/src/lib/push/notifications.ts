/**
 * Task 071 (MX-004) — the notification catalogue, pure. Every push the
 * platform can send is one of these events, and `messageFor` is the only
 * place their copy lives: one title, one plain sentence, the page to open,
 * how urgently the push service should wake the device, and a `tag` that
 * doubles as the idempotency key (lib/push/dispatch.ts). No chain
 * vocabulary anywhere — these land on a lock screen.
 */
import type { PushEvent } from "./push-events.ts";
import type { PushTopic } from "./topics.ts";

export type { PushEvent } from "./push-events.ts";

export interface PushMessage {
  topic: PushTopic;
  /** Unique per event; the second send of one tag is dropped. */
  tag: string;
  title: string;
  body: string;
  /** In-app path to open on tap (see client/src/lib/launch-route.ts). */
  url: string;
  urgency: "high" | "normal" | "low";
  ttlSeconds: number;
}

const marketUrl = (league: string, eventId: string, side?: 0 | 1): string =>
  `/?open=market&league=${encodeURIComponent(league)}&event=${encodeURIComponent(eventId)}${
    side === undefined ? "" : `&side=${String(side)}`
  }`;

export function messageFor(e: PushEvent): PushMessage {
  switch (e.kind) {
    case "trade_confirmed":
      return {
        topic: "trades",
        tag: `trade:${e.txHash.toLowerCase()}`,
        title: "Trade executed",
        body: `You ${e.summary}.`,
        url: "/?open=profile",
        urgency: "high",
        ttlSeconds: 3600,
      };
    case "agent_action":
      return {
        topic: "agent",
        tag: `agent:${e.action}:${e.ref}`,
        title:
          e.action === "hedge"
            ? "Your agent hedged"
            : e.action === "trade"
              ? "Your agent traded"
              : "Your agent has a recommendation",
        body: `${e.summary}.`,
        url: "/?open=agent",
        urgency: "normal",
        ttlSeconds: 4 * 3600,
      };
    case "settlement":
      return {
        topic: "settlement",
        tag: `settlement:${e.ref}`,
        title: e.won === true ? "You won — winnings are ready" : "Market settled",
        body: e.won === true ? `${e.summary}. Tap to claim.` : `${e.summary}.`,
        url: "/?open=profile",
        urgency: "normal",
        ttlSeconds: 24 * 3600,
      };
    case "redeem":
      return {
        topic: "settlement",
        tag: `redeem:${e.ref}`,
        title: "Winnings claimed",
        body: `${e.summary}.`,
        url: "/?open=profile",
        urgency: "low",
        ttlSeconds: 24 * 3600,
      };
    case "game_event":
      return e.phase === "kickoff"
        ? {
            topic: "games",
            tag: `game:${e.eventId}:kickoff`,
            title: `Kickoff: ${e.away} at ${e.home}`,
            body: "You hold a position in this game. Trading stays open until the final whistle.",
            url: marketUrl(e.league, e.eventId),
            urgency: "high",
            ttlSeconds: 2 * 3600,
          }
        : {
            topic: "games",
            tag: `game:${e.eventId}:final`,
            title:
              `Final: ${e.away} ${String(e.awayScore ?? "")} · ${e.home} ${String(e.homeScore ?? "")}`
                .replace(/\s+/g, " ")
                .trim(),
            body: "Trading has closed. Settlement follows once the result is verified.",
            url: marketUrl(e.league, e.eventId),
            urgency: "normal",
            ttlSeconds: 2 * 3600,
          };
    case "position_alert": {
      const up = e.bucket > 0;
      const delta = Math.abs(e.priceCents - e.entryCents);
      return {
        topic: "positions",
        tag: `position:${e.marketId}:${up ? "up" : "down"}${String(Math.abs(e.bucket))}`,
        title: `${e.team} ${up ? "up" : "down"} ${String(delta)}¢ since you bought`,
        body: `Now ${String(e.priceCents)}¢, entry ${String(e.entryCents)}¢. ${
          up ? "Lock in profit or hold" : "Cut the loss or hold"
        } — sell any time before the game goes final.`,
        url: marketUrl(e.league, e.eventId, e.side),
        urgency: "normal",
        ttlSeconds: 1800,
      };
    }
    case "test":
      return {
        topic: "trades",
        tag: `test:${e.nonce}`,
        title: "Mantua notifications are on",
        body: "You'll hear about trades, your positions, game events, your agent, and settlement.",
        url: "/?open=profile",
        urgency: "low",
        ttlSeconds: 600,
      };
  }
}
