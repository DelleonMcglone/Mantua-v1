import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub";
process.env.PRIVY_APP_ID ??= "test-stub";
process.env.PRIVY_APP_SECRET ??= "test-stub";

const { SharedCache } = await import("./shared-cache.ts");
type SharedCacheClient = import("./shared-cache.ts").SharedCacheClient;

/** An in-memory Redis with the three commands the cache uses, plus a
 *  failure switch and a log of calls. Upstash's REST client returns
 *  strings it stored as strings (or parsed JSON when it can); the fake
 *  returns the raw string, which the cache must handle. */
function fakeRedis(): {
  client: SharedCacheClient;
  store: Map<string, { value: string; ex: number }>;
  calls: string[];
  failing: { get: boolean; set: boolean };
} {
  const store = new Map<string, { value: string; ex: number }>();
  const calls: string[] = [];
  const failing = { get: false, set: false };
  const client: SharedCacheClient = {
    get: (key) => {
      calls.push(`get:${key}`);
      if (failing.get) return Promise.reject(new Error("redis down"));
      return Promise.resolve(store.get(key)?.value ?? null);
    },
    set: (key, value, opts) => {
      calls.push(`set:${key}:ex=${String(opts.ex)}`);
      if (failing.set) return Promise.reject(new Error("redis down"));
      store.set(key, { value, ex: opts.ex });
      return Promise.resolve("OK");
    },
    del: (key) => {
      calls.push(`del:${key}`);
      store.delete(key);
      return Promise.resolve(1);
    },
  };
  return { client, store, calls, failing };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Phase 7 / R-007 — two tiers, never a failed read: L1 collapses a burst
 * on one instance, L2 shares the value across instances, and a dead Redis
 * degrades to compute.
 */
void describe("SharedCache", () => {
  void it("computes once per key per window on one instance (L1) and writes through to L2 with a whole-second TTL", async () => {
    const redis = fakeRedis();
    let clock = 1_000_000;
    const cache = new SharedCache({ client: redis.client, now: () => clock });
    let computed = 0;
    const compute = () => {
      computed += 1;
      return Promise.resolve({ n: computed });
    };
    const [a, b, c] = await Promise.all([
      cache.getOrCompute("k", 5_000, compute),
      cache.getOrCompute("k", 5_000, compute),
      cache.getOrCompute("k", 5_000, compute),
    ]);
    assert.deepEqual(
      [a, b, c],
      [{ n: 1 }, { n: 1 }, { n: 1 }],
      "a concurrent burst shares one computation",
    );
    await tick();
    assert.ok(
      redis.calls.includes("set:mantua:cache:k:ex=5"),
      "written through to L2 with ceil(5000/1000)=5 s",
    );
    assert.deepEqual(
      await cache.getOrCompute("k", 5_000, compute),
      { n: 1 },
      "L1 hit inside the window",
    );
    assert.equal(computed, 1);
    clock += 6_000;
    assert.deepEqual(
      await cache.getOrCompute("k", 5_000, compute),
      { n: 2 },
      "recomputed after the window",
    );
  });

  void it("a second instance reads the first instance's value from L2 instead of computing", async () => {
    const redis = fakeRedis();
    const clock = 1_000_000;
    const first = new SharedCache({ client: redis.client, now: () => clock });
    const second = new SharedCache({ client: redis.client, now: () => clock + 1_000 });
    await first.getOrCompute("slate:nfl", 10_000, () => Promise.resolve({ from: "first" }));
    await tick();
    let secondComputed = false;
    const v = await second.getOrCompute("slate:nfl", 10_000, () => {
      secondComputed = true;
      return Promise.resolve({ from: "second" });
    });
    assert.deepEqual(v, { from: "first" });
    assert.equal(secondComputed, false, "the second instance never computed");
    assert.equal(second.snapshot().l2Hits, 1);
  });

  void it("an L2 value's remaining life bounds the L1 copy so the tiers expire together", async () => {
    const redis = fakeRedis();
    let clock = 1_000_000;
    const writer = new SharedCache({ client: redis.client, now: () => clock });
    await writer.getOrCompute("k", 10_000, () => Promise.resolve("v1"));
    await tick();
    clock += 9_500; // 500 ms of life left in L2
    const reader = new SharedCache({ client: redis.client, now: () => clock });
    assert.equal(await reader.getOrCompute("k", 10_000, () => Promise.resolve("v2")), "v1");
    clock += 600; // past the original expiry
    redis.store.clear(); // Redis expired it too
    assert.equal(
      await reader.getOrCompute("k", 10_000, () => Promise.resolve("v2")),
      "v2",
      "L1 did not outlive L2",
    );
  });

  void it("a dead Redis never fails a read — get errors fall through to compute, set errors are dropped", async () => {
    const redis = fakeRedis();
    redis.failing.get = true;
    redis.failing.set = true;
    const cache = new SharedCache({ client: redis.client });
    assert.deepEqual(await cache.getOrCompute("k", 1_000, () => Promise.resolve({ ok: true })), {
      ok: true,
    });
    await tick();
    const snap = cache.snapshot();
    assert.equal(snap.l2, true);
    assert.ok(snap.l2Errors >= 1);
  });

  void it("without Redis it is a per-instance cache (L2 absent), and garbage in L2 is ignored", async () => {
    const local = new SharedCache({ client: null });
    assert.equal(await local.getOrCompute("k", 1_000, () => Promise.resolve(1)), 1);
    assert.equal(local.snapshot().l2, false);

    const redis = fakeRedis();
    redis.store.set("mantua:cache:k", { value: "{not json", ex: 5 });
    const cache = new SharedCache({ client: redis.client });
    assert.equal(
      await cache.getOrCompute("k", 1_000, () => Promise.resolve("computed")),
      "computed",
    );
  });

  void it("invalidate drops both tiers so the next read recomputes", async () => {
    const redis = fakeRedis();
    const cache = new SharedCache({ client: redis.client });
    let n = 0;
    const compute = () => Promise.resolve(++n);
    assert.equal(await cache.getOrCompute("positions:0xabc", 10_000, compute), 1);
    await tick();
    await cache.invalidate("positions:0xabc");
    assert.ok(redis.calls.includes("del:mantua:cache:positions:0xabc"));
    assert.equal(await cache.getOrCompute("positions:0xabc", 10_000, compute), 2);
  });
});
