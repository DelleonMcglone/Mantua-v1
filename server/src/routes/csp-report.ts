/**
 * Task 067 — `POST /api/csp-report`: where the browser sends violations of
 * the report-only Content-Security-Policy (lib/security/csp.ts). Browsers
 * post these without credentials and with their own content types, so the
 * route parses `application/csp-report` and `application/reports+json`
 * itself, caps the body, logs one bounded line per violation, and always
 * answers 204 — a report endpoint must never fail loudly at the browser.
 * The global per-IP limiter still applies.
 */
import express, { Router } from "express";
import { logger } from "../lib/logger.ts";
import { summarizeCspReports, type CspViolation } from "../lib/security/csp-report.ts";

export interface CspReportDeps {
  log: (violation: CspViolation) => void;
}

const parseReport = express.json({
  type: ["application/json", "application/csp-report", "application/reports+json"],
  limit: "16kb",
});

export function createCspReportRouter(overrides: Partial<CspReportDeps> = {}): Router {
  const deps: CspReportDeps = {
    log: (violation) => {
      logger.warn({ csp: violation }, "csp violation reported");
    },
    ...overrides,
  };
  const router = Router();
  router.post("/api/csp-report", parseReport, (req, res) => {
    for (const violation of summarizeCspReports(req.body)) deps.log(violation);
    res.status(204).end();
  });
  return router;
}

export const cspReportRouter = createCspReportRouter();
