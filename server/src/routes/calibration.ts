import { Router, type Request, type Response } from "express";
import { db } from "../db/client.ts";
import { logger } from "../lib/logger.ts";
import { sharedCache } from "../lib/shared-cache.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";
import { forecastsCsv, readScoredRecords } from "../lib/forecast/calibration-read.ts";
import { hitlReport, type HitlReport } from "../lib/forecast/hitl.ts";
import { autonomyReadiness, type ReadinessReport } from "../lib/forecast/autonomy-readiness.ts";
import { isScoreable, type ScoredRecord } from "../lib/forecast/scoring.ts";
import { sliceReport, uniqueViews, type SliceReport } from "../lib/forecast/slices.ts";

/**
 * Task 077 — the calibration view (public, like the agent's public ledger)
 * and the ledger export (owner, Bearer CRON_SECRET).
 *
 *   GET /api/calibration        scores and slices over the whole ledger
 *   GET /api/ops/forecasts.csv  every record, for posting results publicly
 */
export interface CalibrationReport extends SliceReport {
  generatedAt: number;
  totals: {
    records: number;
    views: number;
    scoreable: number;
    pending: number;
    voided: number;
    afterKickoff: number;
  };
  hitl: HitlReport;
  readiness: ReadinessReport;
}

export const CALIBRATION_CACHE_MS = 60_000;

export function buildCalibrationReport(
  records: readonly ScoredRecord[],
  now: number = Date.now(),
): CalibrationReport {
  const slices = sliceReport(records);
  return {
    generatedAt: now,
    totals: {
      records: records.length,
      views: uniqueViews(records).length,
      scoreable: records.filter(isScoreable).length,
      pending: records.filter((r) => r.outcome === null && !r.voided).length,
      voided: records.filter((r) => r.voided).length,
      afterKickoff: records.filter((r) => r.afterKickoff).length,
    },
    ...slices,
    hitl: hitlReport(records),
    readiness: autonomyReadiness(slices.all, slices.byLeague),
  };
}

export interface CalibrationDeps {
  read: () => Promise<ScoredRecord[]>;
}

export function createCalibrationRouter(overrides: Partial<CalibrationDeps> = {}): Router {
  const deps: CalibrationDeps = { read: () => readScoredRecords(db), ...overrides };
  const router = Router();

  router.get("/api/calibration", async (_req: Request, res: Response) => {
    try {
      const body = await sharedCache.getOrCompute(
        "calibration:v1",
        CALIBRATION_CACHE_MS,
        async () => buildCalibrationReport(await deps.read()),
      );
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(body);
    } catch (err) {
      logger.warn({ err }, "calibration report failed");
      res.status(500).json({ error: "Failed to build the calibration report", code: "INTERNAL" });
    }
  });

  router.get("/api/ops/forecasts.csv", requireCronSecret, async (_req: Request, res: Response) => {
    try {
      const rows = await deps.read();
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="mantua-forecasts.csv"');
      res.send(forecastsCsv(rows));
    } catch (err) {
      logger.warn({ err }, "forecast export failed");
      res.status(500).json({ error: "Failed to export the forecast ledger", code: "INTERNAL" });
    }
  });

  return router;
}

export const calibrationRouter = createCalibrationRouter();
