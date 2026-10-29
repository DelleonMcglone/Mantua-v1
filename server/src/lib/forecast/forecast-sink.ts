import { and, eq, gte } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { forecasts, type NewForecastRow } from "../../db/schema/forecasts.ts";
import { logger } from "../logger.ts";
import { forecastFromAnalysis, type ForecastContext } from "./forecast-record.ts";

/**
 * Where the analyze tool hands its output so the ledger sees every
 * probability the agent forms. Best-effort and fire-and-forget: a ledger
 * write never fails or slows the turn that produced the view.
 */
export interface ForecastSink {
  observe(output: Record<string, unknown>, toolArgs: unknown): void;
}

export async function insertForecast(db: DB, row: NewForecastRow): Promise<void> {
  await db.insert(forecasts).values(row);
}

/**
 * Task 079 (F-1) — a surface that is read over and over (the market page
 * behind a 60-second cache, the analyst) writes one row per market, side,
 * source and model version per window. The view is the same until an input
 * or the model changes; a second row inside the hour would only pad the
 * ledger's counts.
 */
export const COALESCE_WINDOW_MS = 60 * 60_000;

export async function hasRecentForecast(
  db: DB,
  row: NewForecastRow,
  since: Date,
): Promise<boolean> {
  const rows = await db
    .select({ id: forecasts.id })
    .from(forecasts)
    .where(
      and(
        eq(forecasts.providerEventId, row.providerEventId),
        eq(forecasts.outcomeIndex, row.outcomeIndex),
        eq(forecasts.source, row.source),
        eq(forecasts.modelVersion, row.modelVersion),
        gte(forecasts.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** An insert that first asks whether an equivalent row landed inside the window. */
export function coalescedInsert(
  deps: {
    exists?: (db: DB, row: NewForecastRow, since: Date) => Promise<boolean>;
    insert?: (db: DB, row: NewForecastRow) => Promise<void>;
    windowMs?: number;
  } = {},
): (db: DB, row: NewForecastRow) => Promise<void> {
  const exists = deps.exists ?? hasRecentForecast;
  const insert = deps.insert ?? insertForecast;
  const windowMs = deps.windowMs ?? COALESCE_WINDOW_MS;
  return async (db, row) => {
    const at = row.createdAt instanceof Date ? row.createdAt : new Date();
    if (await exists(db, row, new Date(at.getTime() - windowMs))) return;
    await insert(db, row);
  };
}

export function makeForecastSink(
  db: DB,
  ctx: Omit<ForecastContext, "tool"> & { toolName: string },
  deps: { insert?: (db: DB, row: NewForecastRow) => Promise<void>; now?: () => Date } = {},
): ForecastSink {
  const insert = deps.insert ?? insertForecast;
  const now = deps.now ?? (() => new Date());
  return {
    observe(output, toolArgs) {
      const row = forecastFromAnalysis(
        output,
        { ...ctx, tool: { name: ctx.toolName, args: toolArgs } },
        now(),
      );
      if (!row) return;
      void insert(db, row).catch((err: unknown) => {
        logger.warn(
          { err, source: ctx.source, action: ctx.action },
          "forecast ledger write failed",
        );
      });
    },
  };
}
