/**
 * `MARKET_SIGNER_PRIVATE_KEY` — a malformed value degrades market
 * operations, it does not take the platform down.
 *
 * 2026-09-23: a bad paste into Vercel production failed the env schema and
 * every route 500'd (board, scores, status) for a key only the market sweep
 * reads. A malformed value is now treated as absent — the supported
 * "markets planned, nothing signed" state — with a warning that never
 * echoes the value.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { dropMalformedSignerKey } = await import("./env.ts");

const KEY = `0x${"ab".repeat(32)}`;

void describe("dropMalformedSignerKey", () => {
  void it("passes a well-formed key through, forgiving surrounding whitespace", () => {
    assert.equal(
      dropMalformedSignerKey({ MARKET_SIGNER_PRIVATE_KEY: KEY }).env["MARKET_SIGNER_PRIVATE_KEY"],
      KEY,
    );
    const padded = dropMalformedSignerKey({ MARKET_SIGNER_PRIVATE_KEY: ` ${KEY}\n` });
    assert.equal(padded.env["MARKET_SIGNER_PRIVATE_KEY"], KEY);
    assert.deepEqual(padded.warnings, []);
  });

  void it("treats a malformed key as absent with a warning that never echoes it", () => {
    for (const bad of [KEY.slice(2), `"${KEY}"`, `${KEY}ff`, "not-a-key"]) {
      const r = dropMalformedSignerKey({ MARKET_SIGNER_PRIVATE_KEY: bad, OTHER: "kept" });
      assert.equal(r.env["MARKET_SIGNER_PRIVATE_KEY"], undefined, bad);
      assert.equal(r.env["OTHER"], "kept");
      assert.equal(r.warnings.length, 1);
      assert.ok(!r.warnings[0].includes(bad), "the warning must not leak the value");
    }
  });

  void it("leaves an unset key alone", () => {
    const r = dropMalformedSignerKey({ OTHER: "x" });
    assert.deepEqual(r, { env: { OTHER: "x" }, warnings: [] });
  });
});
