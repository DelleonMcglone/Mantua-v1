import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messageFor, type PushEvent } from "./notifications.ts";
import { isPushTopic, PUSH_TOPICS, topicEnabled } from "./topics.ts";

/** Words that must never reach a lock screen (T-005's rule, extended). */
const CHAIN_WORDS = /\b(gas|ETH|on-?chain|blockchain|network|mainnet|explorer|wallet address)\b/i;

const EVENTS: PushEvent[] = [
  { kind: "trade_confirmed", summary: "bought 200.00 YES for $100.00", txHash: "0xABC" },
  { kind: "agent_action", action: "hedge", summary: "Agent hedged Chiefs ($40.00)", ref: "s1" },
  { kind: "agent_action", action: "trade", summary: "Agent bought 50.00 YES", ref: "0xdef" },
  { kind: "agent_action", action: "recommendation", summary: "Agent recommended KC", ref: "r1" },
  { kind: "settlement", summary: "Market settled — YES side ($200.00)", ref: "p1", won: true },
  { kind: "settlement", summary: "Market settled — YES side ($0.00)", ref: "p2", won: false },
  { kind: "redeem", summary: "redeemed a winning position for $200.00", ref: "0x1" },
  {
    kind: "game_event",
    phase: "kickoff",
    league: "nfl",
    eventId: "4015",
    away: "Kansas City Chiefs",
    home: "Las Vegas Raiders",
  },
  {
    kind: "game_event",
    phase: "final",
    league: "nfl",
    eventId: "4015",
    away: "Kansas City Chiefs",
    home: "Las Vegas Raiders",
    awayScore: 27,
    homeScore: 20,
  },
  {
    kind: "position_alert",
    league: "nfl",
    eventId: "4015",
    marketId: "0xm",
    side: 1,
    team: "Kansas City Chiefs",
    entryCents: 50,
    priceCents: 62,
    bucket: 1,
  },
  {
    kind: "position_alert",
    league: "nfl",
    eventId: "4015",
    marketId: "0xm",
    side: 1,
    team: "Kansas City Chiefs",
    entryCents: 50,
    priceCents: 31,
    bucket: -1,
  },
  { kind: "test", nonce: "1" },
];

void describe("push notification catalogue (MX-004)", () => {
  void it("every event yields a message with a known topic, a tag, plain copy and an in-app URL", () => {
    const tags = new Set<string>();
    for (const e of EVENTS) {
      const m = messageFor(e);
      assert.ok(isPushTopic(m.topic), m.topic);
      assert.ok(m.tag.length > 0 && m.tag.length <= 160, m.tag);
      assert.ok(m.title.length > 0 && m.body.length > 0);
      assert.ok(m.url.startsWith("/?open="), m.url);
      assert.doesNotMatch(`${m.title} ${m.body}`, CHAIN_WORDS, m.title);
      assert.ok(m.ttlSeconds > 0);
      tags.add(m.tag);
    }
    assert.equal(tags.size, EVENTS.length, "tags are unique per event");
  });

  void it("reads the copy a user would see for the core events", () => {
    assert.equal(messageFor(EVENTS[0]).title, "Trade executed");
    assert.equal(messageFor(EVENTS[0]).body, "You bought 200.00 YES for $100.00.");
    assert.equal(messageFor(EVENTS[0]).tag, "trade:0xabc");
    assert.equal(messageFor(EVENTS[4]).title, "You won — winnings are ready");
    assert.equal(messageFor(EVENTS[5]).title, "Market settled");
    assert.equal(messageFor(EVENTS[7]).title, "Kickoff: Kansas City Chiefs at Las Vegas Raiders");
    assert.equal(
      messageFor(EVENTS[8]).title,
      "Final: Kansas City Chiefs 27 · Las Vegas Raiders 20",
    );
    assert.equal(messageFor(EVENTS[9]).title, "Kansas City Chiefs up 12¢ since you bought");
    assert.equal(messageFor(EVENTS[9]).url, "/?open=market&league=nfl&event=4015&side=1");
    assert.equal(messageFor(EVENTS[10]).title, "Kansas City Chiefs down 19¢ since you bought");
    assert.equal(messageFor(EVENTS[10]).tag, "position:0xm:down1");
  });

  void it("treats an unset topic as on and a false one as off", () => {
    assert.equal(PUSH_TOPICS.length, 5);
    assert.equal(topicEnabled(null, "trades"), true);
    assert.equal(topicEnabled({}, "games"), true);
    assert.equal(topicEnabled({ games: false }, "games"), false);
    assert.equal(topicEnabled({ games: false }, "trades"), true);
    assert.equal(isPushTopic("gas"), false);
  });
});
