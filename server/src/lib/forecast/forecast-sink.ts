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
