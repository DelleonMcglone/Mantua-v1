/**
 * T-023 — data freshness for every surface that depends on live sports or
 * market data. Takes the slate's `fetchedAt` / `dataAsOf` / `delayed`
 * (public-slate.ts) or any read's timestamp and returns one label the
 * `Freshness` stamp renders. Pure: no React, no `@/` imports.
 */
import { relativeTime } from "../../lib/format.ts";

export interface FreshnessInput {
  /** When the data was last fetched — ms or unix seconds, either is fine. */
  fetchedAt?: number | undefined;
  /** Last ingest time when the read is served from a degraded path. */
  dataAsOf?: number | undefined;
  /** The server's own "this is not live" flag. */
  delayed?: boolean | undefined;
}

export interface Freshness {
  label: string;
  /** Older than STALE_AFTER_MS, or no timestamp at all. */
  stale: boolean;
  /** Served from a degraded path — render as delayed, never as live. */
  delayed: boolean;
}

/** Mirrors the server's CANONICAL_FRESH_MS (public-slate.ts). */
export const STALE_AFTER_MS = 5 * 60_000;

/** Accept ms or seconds: anything below 1e11 is treated as seconds. */
function toMs(t: number): number {
  return t < 1e11 ? t * 1000 : t;
}

export function freshness(input: FreshnessInput, nowMs: number = Date.now()): Freshness {
  const asOf = input.dataAsOf ?? input.fetchedAt;
  if (asOf === undefined || !Number.isFinite(asOf)) {
    return { label: "Update time unknown", stale: true, delayed: Boolean(input.delayed) };
  }
  const ms = toMs(asOf);
  const age = relativeTime(Math.floor(ms / 1000), nowMs);
  const delayed = Boolean(input.delayed);
  return {
    label: delayed ? `Data as of ${age}` : `Updated ${age}`,
    stale: nowMs - ms > STALE_AFTER_MS,
    delayed,
  };
}
