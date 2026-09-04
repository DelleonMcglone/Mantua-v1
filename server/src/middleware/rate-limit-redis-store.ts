import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";

/**
 * Minimal Redis surface the shared rate-limit store needs: run one Lua
 * script server-side. `@upstash/redis`'s REST client satisfies this as-is,
 * and tests inject an in-memory fake with the same command semantics. Kept
 * narrow on purpose — the runtime kill-switch work (C-020) reuses this
 * client shape against the same Redis.
 */
export interface RedisRateLimitClient {
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

export interface RedisRateLimitStoreOptions {
  /** Redis backend — any client whose `eval` runs a Lua script. */
  client: RedisRateLimitClient;
  /** Key namespace. MUST be unique per limiter — counters do not cross prefixes. */
  prefix: string;
  /**
   * Window length in ms for direct store use; when attached to a limiter the
   * middleware re-captures the authoritative value via `init(options)`.
   */
  windowMs: number;
}

/**
 * Atomic fixed-window increment (single round trip): INCR the counter, and —
 * on the first hit, or whenever the key lost its TTL (an instance that died
 * between INCR and expiry; healed here) — anchor the absolute expiry. Returns
 * `[hits, ttlMs]` so resetTime comes straight from Redis instead of being
 * re-derived from skewed client clocks.
 */
export const INCREMENT_SCRIPT = `
local hits = redis.call("INCR", KEYS[1])
if redis.call("PTTL", KEYS[1]) < 0 then
  redis.call("PEXPIREAT", KEYS[1], ARGV[1])
end
return { hits, redis.call("PTTL", KEYS[1]) }
`;

/** Read back `[hits, ttlMs]` without counting a hit. */
export const PEEK_SCRIPT = `
return { redis.call("GET", KEYS[1]), redis.call("PTTL", KEYS[1]) }
`;

/**
 * Roll back one hit (skipFailedRequests / skipSuccessfulRequests). The EXISTS
 * guard means it never creates the key, so it can not resurrect a window the
 * way a bare DECR on a missing key would.
 */
export const DECREMENT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  redis.call("DECR", KEYS[1])
end
return { redis.call("GET", KEYS[1]), redis.call("PTTL", KEYS[1]) }
`;

export const RESET_KEY_SCRIPT = `return redis.call("DEL", KEYS[1])`;

/**
 * Upstash returns Lua tables as JSON arrays; integers arrive as numbers and
 * nil as null/undefined. Anything else means client/protocol drift — throw
 * rather than guess (a wrong guess here is a silent limit bypass).
 */
function parseReply(reply: unknown, what: string): (number | undefined)[] {
  if (!Array.isArray(reply)) {
    throw new Error(`rate-limit store: unexpected ${what} reply (${typeof reply})`);
  }
  const rows: unknown[] = reply;
  return rows.map((value) => (value == null ? undefined : Number(value)));
}

/**
 * Build a shared, Redis-backed express-rate-limit `Store` — a fixed window
 * whose counter and TTL both live in Redis, so two lambda instances (or two
 * fresh instances after a recycle) over the same Redis count into the same
 * window. That is exactly the property the default MemoryStore lacks.
 */
export function createRedisRateLimitStore({
  client,
  prefix,
  windowMs,
}: RedisRateLimitStoreOptions): Store {
  let windowLength = windowMs;

  const run = (script: string, key: string, args: (string | number)[] = []): Promise<unknown> =>
    client.eval(script, [`${prefix}${key}`], args);

  const resetTime = (ttlMs: number | undefined): Date | undefined =>
    ttlMs !== undefined && ttlMs >= 0 ? new Date(Date.now() + ttlMs) : undefined;

  return {
    prefix,
    localKeys: false,
    init(options: Options): void {
      windowLength = options.windowMs;
    },
    async get(key: string): Promise<ClientRateLimitInfo | undefined> {
      const [hits, ttlMs] = parseReply(await run(PEEK_SCRIPT, key), "peek");
      if (hits === undefined) return undefined;
      return { totalHits: hits, resetTime: resetTime(ttlMs) };
    },
    async increment(key: string): Promise<ClientRateLimitInfo> {
      // The expiry argument is anchored to now+window on every call; the
      // script only applies it on first hit / TTL loss, so later hits are
      // no-ops and the window never slides forward on activity.
      const [hits, ttlMs] = parseReply(
        await run(INCREMENT_SCRIPT, key, [Date.now() + windowLength]),
        "increment",
      );
      if (hits === undefined) {
        throw new Error("rate-limit store: increment script returned no counter");
      }
      return { totalHits: hits, resetTime: resetTime(ttlMs) };
    },
    async decrement(key: string): Promise<void> {
      await run(DECREMENT_SCRIPT, key);
    },
    async resetKey(key: string): Promise<void> {
      await run(RESET_KEY_SCRIPT, key);
    },
    // resetAll is deliberately unimplemented (optional on the Store contract):
    // over REST it would need an unbounded SCAN across shared keys. Clear a
    // `mantua:rl:*` prefix from the Upstash console instead (runbook §6).
  };
}
