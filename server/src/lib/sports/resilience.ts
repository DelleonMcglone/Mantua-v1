/**
 * B3-003 — retry with backoff, host fallback, TTL caching, and a circuit
 * breaker that degrades to "data delayed" instead of failing.
 *
 * This exists because settlement correctness depends on an endpoint with no SLA
 * (Risk 1). Two rules shape every choice here:
 *
 *  1. **A read failure must not become a settlement failure.** Serving a stale
 *     value flagged `delayed` is strictly better than throwing, because the
 *     resolution service can refuse to settle on delayed data (spec §3.5)
 *     while the board keeps rendering.
 *  2. **Never retry so hard that we become the outage.** ESPN's backend is
 *     unmetered and undocumented; hammering it during a wobble is how a slow
 *     response turns into a block.
 */

import { logger } from "../logger.ts";
import { ProviderUnavailableError } from "./provider.ts";

/** Pre-game slates change slowly; live scores do not. Spec B3-003. */
export const PREGAME_TTL_MS = 60_000;
export const LIVE_TTL_MS = 10_000;

/** How long a stale value may still be served once upstream is failing. */
export const STALE_GRACE_MS = 10 * 60_000;

/** Consecutive failures before the breaker opens. */
export const BREAKER_THRESHOLD = 5;
/** How long the breaker stays open before allowing one probe. */
export const BREAKER_COOLDOWN_MS = 60_000;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;
const TIMEOUT_MS = 8_000;

export interface Fresh<T> {
  value: T;
  /** True when this came from a degraded path and must not be settled on. */
  delayed: boolean;
  fetchedAt: number;
}

interface Entry<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
}

/**
 * Full-jitter exponential backoff.
 *
 * Jitter matters more than the exponent here: the ingest worker polls several
 * leagues on one timer, so a fixed schedule would have every league retry in
 * lockstep and arrive as a burst. Randomising spreads them.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = BASE_BACKOFF_MS * 2 ** attempt;
  return Math.floor(random() * ceiling);
}

/** Per-host failure state, so one bad host does not condemn the others. */
class Breaker {
  private failures = 0;
  private openedAt = 0;

  get isOpen(): boolean {
    if (this.failures < BREAKER_THRESHOLD) return false;
    // After the cooldown, allow exactly one probe through (half-open).
    return Date.now() - this.openedAt < BREAKER_COOLDOWN_MS;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= BREAKER_THRESHOLD && this.openedAt === 0) {
      this.openedAt = Date.now();
    }
  }

  /** Exposed for tests and for the health endpoint. */
  snapshot(): { failures: number; open: boolean } {
    return { failures: this.failures, open: this.isOpen };
  }
}

/**
 * A resilient JSON fetcher over one or more interchangeable hosts.
 *
 * `hosts` are tried in order and each carries its own breaker, so a single
 * failing mirror is skipped rather than taking the provider down.
 */
export class ResilientJson {
  private readonly cache = new Map<string, Entry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly breakers = new Map<string, Breaker>();
  private readonly hosts: readonly string[];
  private readonly fetchImpl: typeof fetch;

  constructor(hosts: readonly string[], fetchImpl: typeof fetch = fetch) {
    if (hosts.length === 0) throw new Error("ResilientJson needs at least one host");
    this.hosts = hosts;
    this.fetchImpl = fetchImpl;
  }

  private breakerFor(host: string): Breaker {
    let b = this.breakers.get(host);
    if (!b) {
      b = new Breaker();
      this.breakers.set(host, b);
    }
    return b;
  }

  breakerState(): Record<string, { failures: number; open: boolean }> {
    return Object.fromEntries(this.hosts.map((h) => [h, this.breakerFor(h).snapshot()]));
  }

  /**
   * Fetch `path`, caching under `key` for `ttlMs`.
   *
   * On total failure, a cached value inside `STALE_GRACE_MS` is returned with
   * `delayed: true`. Only when there is nothing to fall back on does this
   * throw — the caller then has genuinely no data, which is a different
   * situation from having old data.
   */
  async get<T>(key: string, path: string, ttlMs: number): Promise<Fresh<T>> {
    const hit = this.cache.get(key) as Entry<T> | undefined;
    if (hit && hit.expiresAt > Date.now()) {
      return { value: hit.value, delayed: false, fetchedAt: hit.fetchedAt };
    }

    // Collapse concurrent identical requests — the worker and an API caller
    // asking for the same slate should cost one upstream request, not two.
    const pending = this.inFlight.get(key) as Promise<Fresh<T>> | undefined;
    if (pending) return pending;

    const p = this.fetchWithFallback<T>(key, path, ttlMs, hit).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, p);
    return p;
  }

  private async fetchWithFallback<T>(
    key: string,
    path: string,
    ttlMs: number,
    stale: Entry<T> | undefined,
  ): Promise<Fresh<T>> {
    let lastError: unknown;

    for (const host of this.hosts) {
      const breaker = this.breakerFor(host);
      if (breaker.isOpen) {
        logger.warn({ host, path }, "sports: breaker open, skipping host");
        continue;
      }

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(backoffMs(attempt));
        try {
          const value = await this.fetchJson<T>(host, path);
          breaker.recordSuccess();
          const fetchedAt = Date.now();
          this.cache.set(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs });
          return { value, delayed: false, fetchedAt };
        } catch (err) {
          lastError = err;
          breaker.recordFailure();
          logger.warn({ host, path, attempt, err: String(err) }, "sports: fetch failed");
        }
      }
    }

    if (stale && Date.now() - stale.fetchedAt < STALE_GRACE_MS) {
      logger.warn({ path, ageMs: Date.now() - stale.fetchedAt }, "sports: serving stale, delayed");
      return { value: stale.value, delayed: true, fetchedAt: stale.fetchedAt };
    }

    throw new ProviderUnavailableError(
      `all hosts failed for ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  private async fetchJson<T>(host: string, path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${host}${path}`, { signal: controller.signal });
      if (!res.ok) throw new ProviderUnavailableError(`HTTP ${String(res.status)}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
