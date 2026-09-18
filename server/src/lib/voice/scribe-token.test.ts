import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  failureForStatus,
  httpStatusFor,
  mintScribeToken,
  readToken,
  SCRIBE_MODEL_ID,
  TOKEN_ENDPOINT,
  TOKEN_TTL_MS,
  type TokenFetcher,
} from "./scribe-token.ts";

/**
 * Task 069 (V-001) — the token mint. Every case here is about one
 * property: the browser gets a short-lived token or it gets a reason, and
 * the API key is never part of either.
 */
const ok =
  (body: string): TokenFetcher =>
  () =>
    Promise.resolve({ status: 200, text: () => Promise.resolve(body) });

const status =
  (code: number): TokenFetcher =>
  () =>
    Promise.resolve({ status: code, text: () => Promise.resolve("{}") });

void describe("scribe token mint (V-001)", () => {
  void it("exchanges the key for a token and dates its expiry", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetcher: TokenFetcher = (url, init) => {
      seen.push({ url, headers: init.headers });
      return Promise.resolve({ status: 200, text: () => Promise.resolve('{"token":"tok_abc"}') });
    };

    const out = await mintScribeToken({ apiKey: "secret-key", fetcher, now: 1_000 });

    assert.deepEqual(out, {
      status: "ok",
      token: "tok_abc",
      expiresAt: 1_000 + TOKEN_TTL_MS,
      modelId: SCRIBE_MODEL_ID,
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, TOKEN_ENDPOINT);
    assert.equal(seen[0].headers["xi-api-key"], "secret-key");
  });

  void it("reports a deployment with no key rather than calling out", async () => {
    let called = false;
    const fetcher: TokenFetcher = () => {
      called = true;
      return Promise.resolve({ status: 200, text: () => Promise.resolve("{}") });
    };

    const out = await mintScribeToken({ apiKey: undefined, fetcher });

    assert.equal(out.status, "not_configured");
    assert.equal(called, false, "no key means no upstream call");
  });

  void it("maps each upstream status onto its own failure", async () => {
    assert.equal(failureForStatus(401), "unauthorized");
    assert.equal(failureForStatus(403), "unauthorized");
    assert.equal(failureForStatus(402), "quota_exceeded");
    assert.equal(failureForStatus(429), "rate_limited");
    assert.equal(failureForStatus(500), "upstream_unavailable");

    for (const [code, expected] of [
      [401, "unauthorized"],
      [402, "quota_exceeded"],
      [429, "rate_limited"],
      [503, "upstream_unavailable"],
    ] as const) {
      const out = await mintScribeToken({ apiKey: "k", fetcher: status(code) });
      assert.ok(out.status !== "ok", "an error status never yields a token");
      assert.ok(out.reason.length > 0, "every failure carries a sentence");
      assert.equal(out.status, expected);
    }
  });

  void it("treats an unusable body as an upstream fault, never as a token", async () => {
    for (const body of ["not json", "[]", "{}", '{"token":""}', '{"token":42}', "null"]) {
      assert.equal(readToken(body), null, body);
      const out = await mintScribeToken({ apiKey: "k", fetcher: ok(body) });
      assert.equal(out.status, "upstream_unavailable", body);
    }
  });

  void it("turns a transport fault into an outcome rather than throwing", async () => {
    const fetcher: TokenFetcher = () => Promise.reject(new Error("socket hang up"));
    const out = await mintScribeToken({ apiKey: "k", fetcher });
    assert.equal(out.status, "upstream_unavailable");
  });

  void it("answers 503 when voice is off and 429 only when throttled", () => {
    assert.equal(httpStatusFor("ok"), 200);
    assert.equal(httpStatusFor("not_configured"), 503);
    assert.equal(httpStatusFor("quota_exceeded"), 503);
    assert.equal(httpStatusFor("rate_limited"), 429);
    assert.equal(httpStatusFor("unauthorized"), 502);
    assert.equal(httpStatusFor("upstream_unavailable"), 502);
  });
});
