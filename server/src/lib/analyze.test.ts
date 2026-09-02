/**
 * P9-001 — analyze alias resolver tests. Covers the canonical
 * mapping between user-typed token names (bitcoin, btc, cbBTC,
 * etc.) and CoinGecko coin IDs that the runner uses. Pure function;
 * no network. Network-driven runners (`tokenPrice`, etc.) are
 * covered indirectly by the integration probes in this thread plus
 * the end-to-end `/api/analyze` smoke we ran during development.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTokenAlias, TOPICS, topicSchema } from "./analyze.ts";

describe("resolveTokenAlias", () => {
  it("resolves bitcoin / btc to the same canonical entry", () => {
    const a = resolveTokenAlias("bitcoin");
    const b = resolveTokenAlias("btc");
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.coingeckoId, "bitcoin");
    assert.equal(b.coingeckoId, "bitcoin");
    assert.equal(a.symbol, "BTC");
    assert.equal(a.label, "Bitcoin");
  });

  it("resolves ethereum / eth", () => {
    assert.equal(resolveTokenAlias("ethereum")?.coingeckoId, "ethereum");
    assert.equal(resolveTokenAlias("eth")?.coingeckoId, "ethereum");
  });

  it("resolves cbBTC family (cbbtc, cb-btc) before bitcoin", () => {
    // The aliases array orders longer / more specific entries first
    // so 'cbbtc' doesn't fall through to the 'bitcoin' / 'btc' entry.
    assert.equal(resolveTokenAlias("cbbtc")?.coingeckoId, "coinbase-wrapped-btc");
    assert.equal(resolveTokenAlias("cb-btc")?.coingeckoId, "coinbase-wrapped-btc");
    assert.equal(resolveTokenAlias("coinbase wrapped btc")?.coingeckoId, "coinbase-wrapped-btc");
  });

  it("resolves stable / euro coins", () => {
    assert.equal(resolveTokenAlias("usdc")?.coingeckoId, "usd-coin");
    assert.equal(resolveTokenAlias("usdt")?.coingeckoId, "tether");
    assert.equal(resolveTokenAlias("eurc")?.coingeckoId, "euro-coin");
    assert.equal(resolveTokenAlias("euro coin")?.coingeckoId, "euro-coin");
  });

  it("resolves a few RWA names", () => {
    assert.equal(resolveTokenAlias("maker")?.coingeckoId, "maker");
    assert.equal(resolveTokenAlias("mkr")?.coingeckoId, "maker");
    assert.equal(resolveTokenAlias("ondo")?.coingeckoId, "ondo-finance");
    assert.equal(resolveTokenAlias("pendle")?.coingeckoId, "pendle");
  });

  it("is case-insensitive", () => {
    assert.equal(resolveTokenAlias("BITCOIN")?.coingeckoId, "bitcoin");
    assert.equal(resolveTokenAlias("Eth")?.coingeckoId, "ethereum");
    assert.equal(resolveTokenAlias("USDC")?.coingeckoId, "usd-coin");
  });

  it("trims whitespace", () => {
    assert.equal(resolveTokenAlias("  bitcoin  ")?.coingeckoId, "bitcoin");
  });

  it("returns null for unknown / empty input", () => {
    assert.equal(resolveTokenAlias("dogecoin"), null);
    assert.equal(resolveTokenAlias(""), null);
    assert.equal(resolveTokenAlias("   "), null);
  });
});

describe("TOPICS / topicSchema", () => {
  it("includes every documented topic", () => {
    // If a topic is added to the union but missed in TOPICS, the
    // server's z.enum would never accept it. Belt-and-suspenders.
    const expected = [
      "eth-price",
      "eurc-peg",
      "usdc-eurc-pool",
      "top-stablecoins",
      "cbbtc-24h-volume",
      "coinbase-prices",
      "mantua-hooks",
      "token-price",
    ];
    for (const t of expected) {
      assert.ok((TOPICS as readonly string[]).includes(t), `TOPICS missing ${t}`);
    }
  });

  it("topicSchema validates known topics", () => {
    assert.equal(topicSchema.safeParse("eth-price").success, true);
    assert.equal(topicSchema.safeParse("token-price").success, true);
  });

  it("topicSchema rejects unknown topics", () => {
    assert.equal(topicSchema.safeParse("not-a-topic").success, false);
  });
});
