/**
 * Minimal TTL cache with in-flight deduplication, for collapsing bursts of
 * identical RPC reads (slot0, fee-tier resolution, max-input probes) that
 * were tripping the public RPC's request limit. Values and TTLs are
 * caller-chosen per entry; concurrent callers of the same key share one
 * in-flight promise instead of each firing their own request.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();

  /**
   * Get `key` from cache, or compute it via `fetcher`. `ttlMs` may be a
   * number or a function of the fetched value (e.g. cache "initialized"
   * long and "not found" short). Errors are NOT cached — a failed fetch
   * clears the in-flight slot so the next caller retries.
   */
  async get(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number | ((v: T) => number),
  ): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const p = (async () => {
      try {
        const value = await fetcher();
        const ttl = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
        if (ttl > 0) this.store.set(key, { value, expiresAt: Date.now() + ttl });
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }
}
