import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BREAKER_THRESHOLD,
  LIVE_TTL_MS,
  PREGAME_TTL_MS,
  ResilientJson,
  STALE_GRACE_MS,
  backoffMs,
} from "./resilience.ts";
import { ProviderUnavailableError } from "./provider.ts";

/** A fetch stub that answers per-host from a script of behaviours. */
function stubFetch(
  handler: (url: string) => "ok" | "fail",
  body: () => unknown = () => ({ n: 1 }),
) {
  const calls: string[] = [];
  const impl: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (handler(url) === "fail") return Promise.reject(new Error("boom"));
    return Promise.resolve(new Response(JSON.stringify(body()), { status: 200 }));
  };
  return { impl, calls };
}

void describe("backoffMs", () => {
  void it("grows exponentially in its ceiling", () => {
    // Full jitter, so assert the ceiling with random() pinned to just under 1.
    const nearOne = () => 0.999;
    assert.ok(backoffMs(1, nearOne) < backoffMs(3, nearOne));
  });

  void it("is jittered rather than fixed", () => {
    // Lockstep retries across leagues on one timer would arrive as a burst;
    // jitter is what spreads them.
    assert.equal(
      backoffMs(3, () => 0),
      0,
    );
    assert.ok(backoffMs(3, () => 0.999) > 0);
  });
});

void describe("ResilientJson caching", () => {
  void it("serves a fresh value from cache without refetching", async () => {
    const { impl, calls } = stubFetch(() => "ok");
    const http = new ResilientJson(["https://a"], impl);

    const first = await http.get<{ n: number }>("k", "/p", PREGAME_TTL_MS);
    const second = await http.get<{ n: number }>("k", "/p", PREGAME_TTL_MS);

    assert.equal(calls.length, 1, "second read must hit cache");
    assert.equal(first.delayed, false);
    assert.equal(second.delayed, false);
  });

  void it("collapses concurrent identical requests into one fetch", async () => {
    const { impl, calls } = stubFetch(() => "ok");
    const http = new ResilientJson(["https://a"], impl);

    await Promise.all([
      http.get<unknown>("k", "/p", PREGAME_TTL_MS),
      http.get<unknown>("k", "/p", PREGAME_TTL_MS),
      http.get<unknown>("k", "/p", PREGAME_TTL_MS),
    ]);

    assert.equal(calls.length, 1, "the worker and an API caller should cost one request");
  });

  void it("uses a shorter TTL for live data than pre-game", () => {
    // Asserted on the concrete values: 10s live vs 60s pre-game.
    assert.equal(LIVE_TTL_MS, 10_000);
    assert.equal(PREGAME_TTL_MS, 60_000);
  });
});

void describe("ResilientJson host fallback", () => {
  void it("falls through to the second host when the first fails", async () => {
    const { impl, calls } = stubFetch((url) => (url.startsWith("https://a") ? "fail" : "ok"));
    const http = new ResilientJson(["https://a", "https://b"], impl);

    const res = await http.get<unknown>("k", "/p", PREGAME_TTL_MS);
    assert.equal(res.delayed, false, "a successful fallback is live data, not delayed");
    assert.ok(calls.some((u) => u.startsWith("https://b")));
  });

  void it("keeps breaker state per host so one bad mirror does not condemn the rest", async () => {
    const { impl } = stubFetch((url) => (url.startsWith("https://a") ? "fail" : "ok"));
    const http = new ResilientJson(["https://a", "https://b"], impl);

    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      await http.get<unknown>(`k${String(i)}`, "/p", 0);
    }

    const state = http.breakerState();
    assert.ok(state["https://a"].failures > 0, "failing host accrues failures");
    assert.equal(state["https://b"].failures, 0, "healthy host stays clean");
    assert.equal(state["https://b"].open, false);
  });
});

void describe("ResilientJson degradation", () => {
  void it("serves stale data flagged delayed when every host fails", async () => {
    let mode: "ok" | "fail" = "ok";
    const { impl } = stubFetch(() => mode);
    const http = new ResilientJson(["https://a"], impl);

    // Prime with a zero TTL so the next read must go upstream.
    const fresh = await http.get<{ n: number }>("k", "/p", 0);
    assert.equal(fresh.delayed, false);

    mode = "fail";
    const stale = await http.get<{ n: number }>("k", "/p", 0);

    // The whole point: a read failure must not become a settlement failure.
    // The caller gets data plus a flag, and can refuse to settle on it.
    assert.equal(stale.delayed, true);
    assert.equal(stale.value.n, 1);
  });

  void it("throws only when there is nothing to fall back on", async () => {
    const { impl } = stubFetch(() => "fail");
    const http = new ResilientJson(["https://a"], impl);

    await assert.rejects(
      () => http.get<unknown>("cold", "/p", PREGAME_TTL_MS),
      ProviderUnavailableError,
      "no cache and no upstream is genuinely no data",
    );
  });

  void it("treats a non-2xx response as a failure", async () => {
    const impl: typeof fetch = () => Promise.resolve(new Response("nope", { status: 503 }));
    const http = new ResilientJson(["https://a"], impl);
    await assert.rejects(() => http.get<unknown>("k", "/p", 0), ProviderUnavailableError);
  });

  void it("gives stale data a bounded grace window", () => {
    // Old enough and it stops being useful even as a fallback. Ten minutes,
    // an order of magnitude past the pre-game TTL.
    assert.equal(STALE_GRACE_MS, 600_000);
  });
});
