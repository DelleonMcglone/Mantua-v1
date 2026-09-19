import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { charCount, DISCLAIMER, lintPost, MAX_POST_CHARS } from "./compliance.ts";
import { explainMove, type MoveInput } from "./explain-move.ts";
import { priceSignal } from "./price-signal.ts";
import { composePosts, marketUpdatePost, type MarketFacts } from "./templates.ts";

/**
 * Task 070 / AE-002, AE-003, AE-004, AE-006 — the three post templates,
 * each proven to pass the compliance lint with no ledger figures, to fit
 * the platform limit, and to carry the agent's name and public page.
 */

const NOW = 1_800_000_000;
const facts: MarketFacts = {
  marketId: "0x" + "1".repeat(64),
  league: "nfl",
  team: "Buffalo Bills",
  opponent: "Kansas City Chiefs",
  yesBps: 6200,
  change24hBps: 400,
  liquidityUsdc: 12_400,
  startsAt: NOW + 3 * 3600,
  status: "scheduled",
  nowSeconds: NOW,
  agentName: "Sideline Sage",
  pageUrl: "https://mantua.ai/agents/sideline_sage",
};
const move: MoveInput = {
  history: [
    { t: NOW - 5400, p: 0.55 },
    { t: NOW - 60, p: 0.62 },
  ],
  nowSeconds: NOW,
  windowSeconds: 3600,
  flow: { buys: 2, sells: 2 },
  game: {
    status: "scheduled",
    teamScore: null,
    opponentScore: null,
    scoreChanged: false,
    clock: null,
  },
  liquidityUsdc: 12_400,
};

void describe("templates", () => {
  void it("market update states the price, the day's change, the pool and the kickoff", () => {
    const text = marketUpdatePost(facts);
    assert.match(text, /Buffalo Bills YES at 62%/);
    assert.match(text, /\+4 pts today/);
    assert.match(text, /\$12\.4k/);
    assert.match(text, /Sideline Sage/);
    assert.ok(text.includes(facts.pageUrl));
    assert.ok(text.endsWith(DISCLAIMER));
    assert.deepEqual(lintPost(text, { ledgerFigures: [] }).violations, []);
  });

  void it("composes every approved template for a notable move, each within the limit and lint-clean", () => {
    const explained = explainMove(move);
    const signal = priceSignal({
      move: explained,
      liquidityUsdc: 12_400,
      game: move.game,
      team: facts.team,
    });
    const posts = composePosts(facts, explained, signal, [
      "market_update",
      "explain_move",
      "price_signal",
    ]);
    assert.deepEqual(
      posts.map((p) => p.template),
      ["market_update", "explain_move", "price_signal"],
    );
    for (const p of posts) {
      assert.ok(charCount(p.text) <= MAX_POST_CHARS, `${p.template}: ${String(p.text.length)}`);
      assert.deepEqual(lintPost(p.text, { ledgerFigures: [] }).violations, [], p.template);
      assert.equal(p.marketId, facts.marketId);
    }
    assert.match(posts[1].text, /55% to 62%/);
    assert.match(posts[2].text, /before it is public/);
  });

  void it("skips explain-move and price-signal when the move is not notable, and unapproved templates", () => {
    const steady = explainMove({
      ...move,
      history: [
        { t: NOW - 5400, p: 0.61 },
        { t: NOW - 60, p: 0.62 },
      ],
    });
    const signal = priceSignal({
      move: steady,
      liquidityUsdc: 12_400,
      game: move.game,
      team: facts.team,
    });
    const posts = composePosts(facts, steady, signal, ["explain_move", "price_signal"]);
    assert.deepEqual(posts, []);
    const only = composePosts(facts, explainMove(move), signal, ["market_update"]);
    assert.deepEqual(
      only.map((p) => p.template),
      ["market_update"],
    );
  });

  void it("never lets a long team name push a post past the limit", () => {
    const long = {
      ...facts,
      team: "T".repeat(60),
      opponent: "O".repeat(60),
      agentName: "A".repeat(48),
    };
    const text = marketUpdatePost(long);
    assert.ok(charCount(text) <= MAX_POST_CHARS);
    assert.ok(text.endsWith(DISCLAIMER));
  });
});
