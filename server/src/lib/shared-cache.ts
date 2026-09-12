import { Redis } from "@upstash/redis";
import { env } from "../env.ts";
import { logger } from "./logger.ts";

/**
 * Phase 7 / R-007 — the shared read cache for live-game hot paths.
 *
 * Two tiers. L1 is per instance (in-flight dedup, no network, bounded).
 * L2 is the same Upstash Redis the rate limiters and the kill switch
 * already use (C-021), so every lambda instance sees one computed value
 * instead of each computing its own — the class of defect C-021 fixed for
 * counters, fixed for reads. Without Redis configured, L2 is simply
 * absent and the cache is per-instance, exactly as before.
 *
 * Failure posture: the cache never fails a read. A Redis error on get
 * falls through to compute; a Redis error on set is logged and dropped.
 * A value found in L2 older than the caller's TTL is a miss (Redis expiry
 * is the backstop, not the rule). Values must be JSON-serializable (the
 * wire shapes the routes already return). Keys are namespaced
 * `mantua:cache:`.
 */

export interface SharedCacheClient {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, opts: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface SharedCacheOptions {
  client: SharedCacheClient | null;
  prefix?: string;
  now?: () => number;
  /** L1 entry cap per instance; expired entries are swept first. */
  maxEntries?: number;
}

interface Envelope<T> {
  v: T;
  /** ms epoch when computed — surfaced so callers can label age. */
  at: number;
}

interface L1Entry {
  env: Envelope<unknown>;
  expiresAt: number;
}

export class SharedCache {
  private readonly l1 = new Map<string, L1Entry>();
  private readonly inFlight = new Map<string, Promise<Envelope<unknown>>>();
  private readonly client: SharedCacheClient | null;
  private readonly prefix: string;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly stats = { l1Hits: 0, l2Hits: 0, misses: 0, l2Errors: 0 };

  constructor(opts: SharedCacheOptions) {
    this.client = opts.client;
    this.prefix = opts.prefix ?? "mantua:cache:";
    this.now = opts.now ?? (() => Date.now());
    this.maxEntries = opts.maxEntries ?? 2_000;
  }

  /**
   * Get `key` from L1, else L2, else compute — and write through to both.
   * `ttlMs` bounds both tiers (L2 in whole seconds, minimum 1); an L2 value
   * keeps only its remaining life in L1 so the tiers expire together.
   */
  async getOrCompute<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const hit = this.l1.get(key);
    if (hit && hit.expiresAt > this.now()) {
      this.stats.l1Hits += 1;
      return hit.env.v as T;
    }
    const pending = this.inFlight.get(key);
    if (pending) return (await pending).v as T;

    const p = (async (): Promise<Envelope<unknown>> => {
      const fromL2 = await this.readL2<T>(key, ttlMs);
      let envelope: Envelope<T>;
      if (fromL2) {
        this.stats.l2Hits += 1;
        envelope = fromL2;
      } else {
        this.stats.misses += 1;
        envelope = { v: await compute(), at: this.now() };
        void this.writeL2(key, envelope, ttlMs);
      }
      const remaining = ttlMs - (this.now() - envelope.at);
      if (remaining > 0) this.l1Set(key, { env: envelope, expiresAt: this.now() + remaining });
      return envelope;
    })().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, p);
    return (await p).v as T;
  }

  /** Drop a key from both tiers (an invalidation after a write). */
  async invalidate(key: string): Promise<void> {
    this.l1.delete(key);
    if (!this.client) return;
    try {
      await this.client.del(this.prefix + key);
    } catch (err) {
      this.stats.l2Errors += 1;
      logger.warn({ err, key }, "shared-cache: del failed");
    }
  }

  snapshot(): {
    l2: boolean;
    l1Entries: number;
    l1Hits: number;
    l2Hits: number;
    misses: number;
    l2Errors: number;
  } {
    return { l2: this.client !== null, l1Entries: this.l1.size, ...this.stats };
  }

  private l1Set(key: string, entry: L1Entry): void {
    if (this.l1.size >= this.maxEntries) {
      const now = this.now();
      for (const [k, e] of this.l1) if (e.expiresAt <= now) this.l1.delete(k);
      // Still full: drop the oldest-inserted entries (Map preserves order).
      let excess = this.l1.size - this.maxEntries + 1;
      for (const k of this.l1.keys()) {
        if (excess <= 0) break;
        this.l1.delete(k);
        excess -= 1;
      }
    }
    this.l1.set(key, entry);
  }

  private async readL2<T>(key: string, ttlMs: number): Promise<Envelope<T> | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(this.prefix + key);
      if (raw === null || raw === undefined) return null;
      const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (typeof parsed !== "object" || parsed === null || !("v" in parsed) || !("at" in parsed)) {
        return null;
      }
      const e = parsed as Envelope<T>;
      if (typeof e.at !== "number") return null;
      // Older than this caller's window is a miss even if Redis kept it.
      if (this.now() - e.at > ttlMs) return null;
      return e;
    } catch (err) {
      this.stats.l2Errors += 1;
      logger.warn({ err, key }, "shared-cache: get failed — computing");
      return null;
    }
  }

  private async writeL2<T>(key: string, envelope: Envelope<T>, ttlMs: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(this.prefix + key, JSON.stringify(envelope), {
        ex: Math.max(1, Math.ceil(ttlMs / 1000)),
      });
    } catch (err) {
      this.stats.l2Errors += 1;
      logger.warn({ err, key }, "shared-cache: set failed");
    }
  }
}

function clientFromEnv(): SharedCacheClient | null {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = env;
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  const redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
  return {
    get: (key) => redis.get(key),
    set: (key, value, opts) => redis.set(key, value, opts),
    del: (key) => redis.del(key),
  };
}

/** The process-wide cache — L2 when Upstash is configured, L1 only otherwise. */
export const sharedCache = new SharedCache({ client: clientFromEnv() });
