/**
 * Task 071 (MX-004) — every event the platform can push, as data. The copy
 * for each lives in notifications.ts (`messageFor`); the producers are the
 * activity bridge (trades, agent actions, settlement) and the live-sync
 * passes (game events, position alerts).
 */
export type PushEvent =
  | { kind: "trade_confirmed"; summary: string; txHash: string }
  | {
      kind: "agent_action";
      action: "trade" | "hedge" | "recommendation";
      summary: string;
      ref: string;
    }
  | { kind: "settlement"; summary: string; ref: string; won: boolean | null }
  | { kind: "redeem"; summary: string; ref: string }
  | {
      kind: "game_event";
      phase: "kickoff" | "final";
      league: string;
      eventId: string;
      away: string;
      home: string;
      awayScore?: number;
      homeScore?: number;
    }
  | {
      kind: "position_alert";
      league: string;
      eventId: string;
      marketId: string;
      side: 0 | 1;
      team: string;
      entryCents: number;
      priceCents: number;
      /** Which 10¢ step from entry this alert marks; signed by direction. */
      bucket: number;
    }
  | { kind: "test"; nonce: string };
