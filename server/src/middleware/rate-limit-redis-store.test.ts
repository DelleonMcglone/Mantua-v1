import { describe, it } from "node:test";
import assert from "node:assert/strict";
import rateLimit from "express-rate-limit";
import type { RateLimitRequestHandler, Store } from "express-rate-limit";
import type { Request, Response } from "express";
import {
  createRedisRateLimitStore,
  DECREMENT_SCRIPT,
  INCREMENT_SCRIPT,
  PEEK_SCRIPT,
  RESET_KEY_SCRIPT,
} from "./rate-limit-redis-store.ts";

/**
 * In-memory stand-in for the Redis commands the store's scripts use (INCR,
 * PEXPIREAT, PTTL, GET, DECR, DEL). Command semantics — lazy expiry,
 * INCR-on-expired-key deleting first, PTTL's -1/-2 sentinels — mirror real
 * Redis so the tests exercise the store's logic against Redis's contract,
 * not against a second copy of its scripts. `eval` dispatches on the exact
 * script constants, so a changed script fails loudly instead of quietly
 * testing the wrong thing.
 */
class FakeRedis {
  private values = new Map<string, string>();
  private expiresAt = new Map<string, number>();
  pexpireCalls = 0;

  /** Pre-seed a key; `expiresAt === undefined` means no TTL (a zombie). */
  seed(key: string, value: string, expiresAt?: number): void {
    this.values.set(key, value);
    if (expiresAt !== undefined) {
      this.expiresAt.set(key, expiresAt);
    } else {
      this.expiresAt.delete(key);
    }
  }

  private ttlOf(key: string): number {
    const expiresAt = this.expiresAt.get(key);
    if (expiresAt === undefined) return -1;
    if (expiresAt <= Date.now()) {
      // Real Redis drops expired keys when they are accessed.
      this.values.delete(key);
      this.expiresAt.delete(key);
      return -2;
    }
    return expiresAt - Date.now();
  }

  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    const key = keys[0];
    if (script === INCREMENT_SCRIPT) {
      this.ttlOf(key); // lazy-expire like a real INCR on an expired key
      const hits = Number(this.values.get(key) ?? "0") + 1;
      this.values.set(key, String(hits));
      if (this.ttlOf(key) < 0) {
        this.expiresAt.set(key, Number(args[0]));
        this.pexpireCalls += 1;
      }
      return Promise.resolve([hits, this.ttlOf(key)]);
    }
    if (script === PEEK_SCRIPT) {
      return Promise.resolve([this.values.get(key) ?? null, this.ttlOf(key)]);
    }
    if (script === DECREMENT_SCRIPT) {
      if (this.values.has(key)) this.values.set(key, String(Number(this.values.get(key)) - 1));
      return Promise.resolve([this.values.get(key) ?? null, this.ttlOf(key)]);
    }
    if (script === RESET_KEY_SCRIPT) {
      const existed = this.values.delete(key);
      this.expiresAt.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }
    return Promise.reject(new Error(`FakeRedis does not implement script: ${script.slice(0, 32)}`));
  }
}

function makeStore(fake: FakeRedis, prefix: string, windowMs = 60_000): Store {
  return createRedisRateLimitStore({ client: fake, prefix, windowMs });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

void describe("createRedisRateLimitStore", () => {
  void it("shares counters across two store instances over the same Redis (simulated lambda recycle)", async () => {
    const fake = new FakeRedis();
    const firstInstance = makeStore(fake, "mantua:rl:test:");
    const secondInstance = makeStore(fake, "mantua:rl:test:");

    await firstInstance.increment("ip:1.2.3.4");
    await firstInstance.increment("ip:1.2.3.4");
    const third = await firstInstance.increment("ip:1.2.3.4");
    assert.equal(third.totalHits, 3);

    // A brand-new lambda with a brand-new store sees the same window:
    const fresh = await secondInstance.increment("ip:1.2.3.4");
    assert.equal(fresh.totalHits, 4);
    assert.ok(
      third.resetTime !== undefined &&
        fresh.resetTime !== undefined &&
        Math.abs(fresh.resetTime.getTime() - third.resetTime.getTime()) < 5_000,
      "both instances report the same window end",
    );
  });

  void it("keeps limiters namespaced by prefix", async () => {
    const fake = new FakeRedis();
    const ipLimiter = makeStore(fake, "mantua:rl:ip:");
    const writeLimiter = makeStore(fake, "mantua:rl:write:");

    await ipLimiter.increment("shared-key");
    await ipLimiter.increment("shared-key");
    const write = await writeLimiter.increment("shared-key");
    assert.equal(write.totalHits, 1, "a different prefix counts independently");
  });

  void it("rolls the window after the TTL lapses", async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake, "mantua:rl:short:", 50);

    const before = await store.increment("ip:1.2.3.4");
    assert.equal(before.totalHits, 1);

    await sleep(80);

    const after = await store.increment("ip:1.2.3.4");
    assert.equal(after.totalHits, 1, "the expired window starts over");
    assert.ok(after.resetTime !== undefined && after.resetTime.getTime() > Date.now());
  });

  void it("re-anchors a lost TTL instead of counting into a zombie key", async () => {
    const fake = new FakeRedis();
    // A key that lost its TTL (e.g. an instance died between INCR and expiry).
    fake.seed("mantua:rl:test:ip:1.2.3.4", "5");

    const store = makeStore(fake, "mantua:rl:test:");
    const next = await store.increment("ip:1.2.3.4");

    assert.equal(next.totalHits, 6, "the counter continues from the shared value");
    assert.ok(next.resetTime instanceof Date, "the healed key has a live expiry again");
    assert.ok(fake.pexpireCalls >= 1, "PEXPIREAT was re-applied");
  });

  void it("resetKey clears the shared counter for every instance", async () => {
    const fake = new FakeRedis();
    const firstInstance = makeStore(fake, "mantua:rl:test:");
    const secondInstance = makeStore(fake, "mantua:rl:test:");

    await firstInstance.increment("ip:1.2.3.4");
    await firstInstance.increment("ip:1.2.3.4");
    await firstInstance.resetKey("ip:1.2.3.4");

    const fresh = await secondInstance.increment("ip:1.2.3.4");
    assert.equal(fresh.totalHits, 1, "the reset is visible instance-wide");
  });

  void it("get reports the shared count and reset time, or undefined for unknown keys", async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake, "mantua:rl:test:");

    assert.equal(await store.get?.("ip:1.2.3.4"), undefined);

    await store.increment("ip:1.2.3.4");
    await store.increment("ip:1.2.3.4");
    const peeked = await store.get?.("ip:1.2.3.4");
    assert.ok(peeked, "get returned the shared record");
    assert.equal(peeked.totalHits, 2);
    assert.ok(peeked.resetTime instanceof Date);
  });

  void it("decrement rolls one hit back without resurrecting a missing key", async () => {
    const fake = new FakeRedis();
    const store = makeStore(fake, "mantua:rl:test:");

    await store.increment("ip:1.2.3.4");
    await store.increment("ip:1.2.3.4");
    await store.decrement("ip:1.2.3.4");
    assert.equal((await store.get?.("ip:1.2.3.4"))?.totalHits, 1, "two hits minus one rollback");

    await store.resetKey("ip:1.2.3.4");
    await store.decrement("ip:1.2.3.4");
    assert.equal(
      await store.get?.("ip:1.2.3.4"),
      undefined,
      "DECR on a missing key creates nothing",
    );
  });
});

interface FireResult {
  nextCalled: boolean;
  statusCodes: number[];
  headers: Record<string, unknown>;
}

/** Drive one request through the real middleware with a minimal req/res. */
function fire(middleware: RateLimitRequestHandler, ip: string): Promise<FireResult> {
  return new Promise<FireResult>((resolve) => {
    const statusCodes: number[] = [];
    const headers: Record<string, unknown> = {};
    const done = (nextCalled: boolean): void => {
      resolve({ nextCalled, statusCodes, headers });
    };
    const res = {
      status(code: number) {
        statusCodes.push(code);
        return res;
      },
      send() {
        done(false);
        return res;
      },
      json() {
        done(false);
        return res;
      },
      setHeader(name: string, value: unknown) {
        headers[name] = value;
        return res;
      },
    } as unknown as Response;
    middleware({ ip, headers: {}, app: { get: () => false } } as unknown as Request, res, () => {
      done(true);
    });
  });
}

/**
 * Two "lambdas": fresh middleware + fresh store, same Redis backend.
 * Mirrors the passOnStoreError wiring in rate-limit.ts's withSharedStore.
 */
function lambdaInstance(fake: FakeRedis): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 3,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store: makeStore(fake, "mantua:rl:e2e:"),
    passOnStoreError: true,
    logger: {
      error: (error: unknown, message?: string): void => {
        console.error("[rate-limit]", error, message);
      },
      warn: (error: unknown, message?: string): void => {
        console.warn("[rate-limit]", error, message);
      },
    },
  });
}

void describe("express-rate-limit over the shared store", () => {
  void it("the limit survives a simulated instance recycle end to end", async () => {
    const fake = new FakeRedis();
    const instanceA = lambdaInstance(fake);
    const instanceB = lambdaInstance(fake);

    for (let hit = 0; hit < 3; hit += 1) {
      const result = await fire(instanceA, "1.2.3.4");
      assert.equal(result.nextCalled, true, `hit ${String(hit + 1)} passes on the first instance`);
      assert.equal(result.statusCodes.length, 0, `hit ${String(hit + 1)} is not rate limited`);
    }

    const blockedOnA = await fire(instanceA, "1.2.3.4");
    assert.equal(blockedOnA.nextCalled, false, "hit 4 is blocked on the first instance");
    assert.deepEqual(blockedOnA.statusCodes, [429]);

    // The "recycle": a brand-new middleware + store, same Redis. The limit
    // must NOT start over — this is the property in-memory counting lacks.
    const blockedOnB = await fire(instanceB, "1.2.3.4");
    assert.equal(blockedOnB.nextCalled, false, "the new instance blocks immediately");
    assert.deepEqual(blockedOnB.statusCodes, [429]);
    // express-rate-limit v8's draft-7 headers use the combined RateLimit header;
    // remaining=0 on instance B proves the shared count reached its headers too.
    const combined = blockedOnB.headers["RateLimit"];
    assert.equal(
      typeof combined === "string" &&
        combined.startsWith("limit=3") &&
        combined.includes("remaining=0"),
      true,
      "draft-7 headers reflect the shared count on instance B",
    );

    // A different client is unaffected.
    const otherIp = await fire(instanceB, "5.6.7.8");
    assert.equal(otherIp.nextCalled, true, "another IP keeps its own window");
  });
});
