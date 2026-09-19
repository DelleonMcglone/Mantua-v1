import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postToX, X_TWEETS_URL, xCredentialsFromEnv } from "./x-client.ts";

/**
 * Task 070 / AE-001 — the X API v2 client over a `fetch` seam: one signed
 * POST, every outcome mapped to a typed result, nothing thrown.
 */

const CREDS = {
  consumerKey: "ck",
  consumerSecret: "cs",
  accessToken: "at",
  accessTokenSecret: "as",
};

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  status: number,
  body: unknown,
  captured: Captured[],
): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return (url, init) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    captured.push({ url: href, init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
}

void describe("xCredentialsFromEnv", () => {
  void it("needs all four values, else null (posting becomes a dry run)", () => {
    assert.equal(
      xCredentialsFromEnv({ X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c" }),
      null,
    );
    assert.deepEqual(
      xCredentialsFromEnv({
        X_API_KEY: "a",
        X_API_SECRET: "b",
        X_ACCESS_TOKEN: "c",
        X_ACCESS_TOKEN_SECRET: "d",
      }),
      { consumerKey: "a", consumerSecret: "b", accessToken: "c", accessTokenSecret: "d" },
    );
  });
});

void describe("postToX", () => {
  void it("sends one signed JSON POST to the v2 tweets endpoint and returns the post id", async () => {
    const captured: Captured[] = [];
    const result = await postToX(CREDS, "hello", {
      fetch: fakeFetch(201, { data: { id: "17", text: "hello" } }, captured),
    });
    assert.deepEqual(result, { ok: true, id: "17" });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, X_TWEETS_URL);
    assert.equal(captured[0].init.method, "POST");
    const headers = new Headers(captured[0].init.headers);
    assert.ok(headers.get("authorization")?.startsWith("OAuth "));
    assert.ok(headers.get("authorization")?.includes('oauth_consumer_key="ck"'));
    assert.equal(headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(captured[0].init.body as string), { text: "hello" });
  });

  void it("maps a rejected request to a typed failure carrying the status and X's detail", async () => {
    const result = await postToX(CREDS, "hello", {
      fetch: fakeFetch(429, { title: "Too Many Requests", detail: "Rate limit exceeded" }, []),
    });
    assert.deepEqual(result, { ok: false, status: 429, error: "Rate limit exceeded" });
  });

  void it("maps a transport fault to a failure with no status", async () => {
    const result = await postToX(CREDS, "hello", {
      fetch: () => Promise.reject(new Error("socket hang up")),
    });
    assert.deepEqual(result, { ok: false, status: null, error: "socket hang up" });
  });

  void it("treats a 2xx without an id as a failure rather than a phantom post", async () => {
    const result = await postToX(CREDS, "hello", { fetch: fakeFetch(200, { data: {} }, []) });
    assert.equal(result.ok, false);
  });
});
