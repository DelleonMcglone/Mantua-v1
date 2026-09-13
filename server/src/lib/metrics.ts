import type { RequestHandler } from "express";
import { logger } from "./logger.ts";

/**
 * Phase 7 / R-003 + R-010 — the latency budget and the in-process metrics
 * behind `/api/ops/metrics`.
 *
 * **Budgets** are p95 targets in milliseconds for the paths a user waits
 * on during a live game. They are enforced, not aspirational: every
 * classified request is timed at the edge of Express, a request over
 * budget emits a structured `latency_budget_exceeded` event (the line an
 * alerting drain keys on), and the p95 over the last window is what the
 * alert evaluator (`alerts.ts`) and the load test (task 054) assert.
 *
 * Why these numbers (topology after task 052: function, Neon and Upstash
 * in `iad1`, a dedicated Base RPC):
 *  - `quote`  800 ms — 5 serial RPC hops (marketOf, yesToken, quoter,
 *    slot0, quoteFee) at ~100 ms each on a dedicated endpoint + one DB
 *    read. The ticket re-quotes on every keystroke behind a 400 ms
 *    debounce; a quote slower than the debounce reads as lag.
 *  - `calldata` 1 200 ms — the quote path plus the cap check/record.
 *  - `fill`   2 500 ms — two receipt reads + the insert + bookkeeping.
 *  - `status`   300 ms — one cached aggregate; the banner's source.
 *  - `slate`    500 ms — cached canonical read + cached live-odds overlay.
 *  - `positions` 1 500 ms — cached per wallet; the cold path is ~3 RPC
 *    reads per market row.
 *  - `confirmation` 8 000 ms — client-side, Base blocks are ~2 s; the
 *    ticket waits 60 s before handing off to the pending register, and
 *    p95 under four blocks is the target the register's `slow` label is
 *    tuned against. Measured by the load test, not by this middleware.
 *
 * Everything here is per lambda instance (there is no shared metrics
 * store); the ops read says so and aggregation across instances is the
 * log drain's job (docs/ops/monitoring.md).
 */

import { LATENCY_BUDGETS_MS, routeBudgetKey, type BudgetKey } from "./latency-budgets.ts";

export {
  CONFIRMATION_BUDGET_MS,
  LATENCY_BUDGETS_MS,
  routeBudgetKey,
  type BudgetKey,
} from "./latency-budgets.ts";

// ─── Latency samples ────────────────────────────────────────────────────────

/** Samples kept per key — a game-time window of the hot paths, bounded. */
export const SAMPLE_WINDOW = 512;

export interface LatencySnapshot {
  key: BudgetKey;
  budgetMs: number;
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  /** Requests over budget in the window. */
  violations: number;
  /** 5xx responses in the window. */
  errors: number;
}

/** Nearest-rank percentile over a copy, sorted. */
export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

class Ring {
  private readonly buf: number[] = [];
  private readonly flags: { over: boolean; error: boolean }[] = [];
  private next = 0;
  private readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  push(ms: number, over: boolean, error: boolean): void {
    if (this.buf.length < this.size) {
      this.buf.push(ms);
      this.flags.push({ over, error });
    } else {
      this.buf[this.next] = ms;
      this.flags[this.next] = { over, error };
    }
    this.next = (this.next + 1) % this.size;
  }
  samples(): readonly number[] {
    return this.buf;
  }
  violations(): number {
    return this.flags.filter((f) => f.over).length;
  }
  errors(): number {
    return this.flags.filter((f) => f.error).length;
  }
}

export class LatencyRecorder {
  private readonly rings = new Map<BudgetKey, Ring>();
  private readonly budgets: Readonly<Record<BudgetKey, number>>;
  private readonly window: number;
  constructor(
    budgets: Readonly<Record<BudgetKey, number>> = LATENCY_BUDGETS_MS,
    window: number = SAMPLE_WINDOW,
  ) {
    this.budgets = budgets;
    this.window = window;
  }

  /** Record one request. Returns true when it exceeded the budget. */
  record(key: BudgetKey, ms: number, status: number): boolean {
    let ring = this.rings.get(key);
    if (!ring) {
      ring = new Ring(this.window);
      this.rings.set(key, ring);
    }
    const over = ms > this.budgets[key];
    ring.push(ms, over, status >= 500);
    return over;
  }

  snapshot(): LatencySnapshot[] {
    const out: LatencySnapshot[] = [];
    for (const key of Object.keys(this.budgets) as BudgetKey[]) {
      const ring = this.rings.get(key);
      const s = ring?.samples() ?? [];
      out.push({
        key,
        budgetMs: this.budgets[key],
        count: s.length,
        p50: percentile(s, 50),
        p95: percentile(s, 95),
        p99: percentile(s, 99),
        max: s.length > 0 ? Math.max(...s) : null,
        violations: ring?.violations() ?? 0,
        errors: ring?.errors() ?? 0,
      });
    }
    return out;
  }
}

// ─── Counters (trade outcomes, stream, cache) ───────────────────────────────

export class Counters {
  private readonly map = new Map<string, number>();
  inc(name: string, by = 1): void {
    this.map.set(name, (this.map.get(name) ?? 0) + by);
  }
  get(name: string): number {
    return this.map.get(name) ?? 0;
  }
  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

/** Process-wide instances (per lambda). */
export const latency = new LatencyRecorder();
export const counters = new Counters();

/**
 * Express middleware: time every classified request, record it, and emit
 * the structured budget-violation event. Mounted right after the request
 * logger so the measurement brackets everything below it (rate limiters,
 * auth, the handler).
 */
export function createLatencyMiddleware(
  recorder: LatencyRecorder = latency,
  classify: typeof routeBudgetKey = routeBudgetKey,
  now: () => number = () => performance.now(),
): RequestHandler {
  return (req, res, next) => {
    const key = classify(req.method, req.path);
    if (!key) {
      next();
      return;
    }
    const started = now();
    res.on("finish", () => {
      const ms = Math.round(now() - started);
      const over = recorder.record(key, ms, res.statusCode);
      if (over) {
        logger.warn(
          {
            event: "latency_budget_exceeded",
            key,
            ms,
            budgetMs: LATENCY_BUDGETS_MS[key],
            status: res.statusCode,
          },
          "latency budget exceeded",
        );
      }
    });
    next();
  };
}

export const latencyMiddleware: RequestHandler = createLatencyMiddleware();
