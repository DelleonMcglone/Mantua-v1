import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectIntent, extractLeague, extractTeamHint } from "./chat-intent.ts";

/**
 * The chat intents after the scope cut (no swap / liquidity / bridge /
 * token analytics; NFL only). Each case is a phrase the dock must route
 * the same way the surface it names does.
 */
void describe("chat-intent: the agent", () => {
  void it("routes agent management to the agent with the message", () => {
    for (const text of [
      "Show me my agent wallet",
      "create an agent",
      "manage my agent",
      "have my agent hedge my Chiefs position",
      "check my agent's balance",
    ]) {
      assert.deepEqual(detectIntent(text), { kind: "agent", message: text }, text);
    }
  });
  void it("does not treat a research mention of agents as the agent", () => {
    assert.notEqual(detectIntent("explain how AI agents work in sports betting")?.kind, "agent");
  });
});

void describe("chat-intent: discovery (T-019)", () => {
  void it("recognises the discovery phrasings with their filters", () => {
    assert.deepEqual(detectIntent("What can I trade right now?"), {
      kind: "discover",
      filters: { startsWithin: "now", status: "open" },
    });
    assert.deepEqual(detectIntent("Show me today's NFL markets"), {
      kind: "discover",
      filters: { league: "nfl", startsWithin: "today" },
    });
    assert.deepEqual(detectIntent("Find the most liquid NFL markets"), {
      kind: "discover",
      filters: { league: "nfl", sort: "liquidity" },
    });
  });
  void it("never routes research phrasing to discovery", () => {
    assert.equal(detectIntent("Analyze today's NFL games")?.kind, "analyze");
  });
});

void describe("chat-intent: positions (B8-003, T-017)", () => {
  void it("opens, closes and hedges with the league and team hint", () => {
    assert.deepEqual(detectIntent("bet on the Chiefs"), {
      kind: "position",
      action: "open",
      team: "chiefs",
    });
    assert.deepEqual(detectIntent("open a position on the Eagles"), {
      kind: "position",
      action: "open",
      team: "eagles",
    });
    // A league word inside the capture is not a team; the league still lands.
    assert.deepEqual(detectIntent("open a position on the Eagles in the NFL"), {
      kind: "position",
      action: "open",
      sport: "nfl",
    });
    assert.deepEqual(detectIntent("close my nfl position"), {
      kind: "position",
      action: "close",
      sport: "nfl",
    });
    assert.deepEqual(detectIntent("hedge my NFL exposure"), {
      kind: "position",
      action: "hedge",
      sport: "nfl",
    });
  });
  void it("extracts the team after on / for / against and rejects league words", () => {
    assert.equal(extractTeamHint("bet on the Bills tonight"), "bills");
    assert.equal(extractTeamHint("wager against Dallas"), "dallas");
    assert.equal(extractTeamHint("bet on the nfl"), null);
    assert.equal(extractTeamHint("bet on it"), null);
  });
});

void describe("chat-intent: league nav", () => {
  void it("opens the NFL page on a browse cue or the bare league", () => {
    for (const text of ["nfl", "NFL markets", "show nfl games", "go to the nfl slate"]) {
      assert.deepEqual(detectIntent(text), { kind: "market", sport: "nfl" }, text);
    }
  });
  void it("only recognises the covered league", () => {
    assert.equal(extractLeague("show me the wnba games"), null);
    assert.equal(extractLeague("nba markets"), null);
    assert.equal(extractLeague("NFL week 3"), "nfl");
  });
  void it("hands NFL analysis to the analyst, not the league page", () => {
    assert.deepEqual(detectIntent("analyze the NFL matchup: Chiefs at Bills"), {
      kind: "analyze",
      question: "analyze the NFL matchup: Chiefs at Bills",
    });
  });
});

void describe("chat-intent: portfolio, home, research and the fallback", () => {
  void it("routes the portfolio and positions to the profile", () => {
    assert.deepEqual(detectIntent("Show me my portfolio"), { kind: "portfolio" });
    assert.deepEqual(detectIntent("my open positions"), { kind: "portfolio" });
  });
  void it("routes home", () => {
    assert.deepEqual(detectIntent("go home"), { kind: "home" });
  });
  void it("routes research openers to the analyst with the question", () => {
    assert.deepEqual(detectIntent("Explain the Chiefs injury situation"), {
      kind: "analyze",
      question: "Explain the Chiefs injury situation",
    });
    // A time cue plus "game(s)" is browsing, not research (T-019).
    assert.deepEqual(detectIntent("Which game looks closest today?"), {
      kind: "discover",
      filters: { startsWithin: "today" },
    });
  });
  void it("returns null for anything else so the caller falls back to the analyst", () => {
    assert.equal(detectIntent("hello there"), null);
  });
  void it("has no trading intents left", () => {
    for (const text of [
      "Swap 100 USDC for EURC",
      "Add liquidity to a USDC/EURC pool",
      "bridge 10 USDC to Base",
      "send 5 USDC to 0x1111111111111111111111111111111111111111",
      "Is EURC holding its peg?",
    ]) {
      const kind = detectIntent(text)?.kind ?? null;
      assert.ok(
        kind === null || kind === "analyze",
        `${text} → ${String(kind)} (expected no trading intent)`,
      );
    }
  });
});
