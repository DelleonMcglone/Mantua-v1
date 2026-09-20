import { Router, type Response } from "express";
import { db } from "../db/client.ts";
import { BASE_CHAIN_ID } from "../lib/chains.ts";
import { CircleUnavailableError } from "../lib/circle/client.ts";
import { reconcileInstitution } from "../lib/custody/custody-reconcile-run.ts";
import {
  auditCsv,
  institutionAuditRows,
  institutionStatement,
} from "../lib/custody/custody-reports.ts";
import { statementCsv } from "../lib/custody/custody-statement.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { allow, memberContext } from "./institution-context.ts";
import { parsePeriod } from "./institution-period.ts";

/**
 * Task 073 / IC-002 — reporting for members with `view_reports`: the
 * period statement and the audit trail as JSON or CSV, and the
 * reconciliation of Circle's balances against the chain.
 */

export const institutionReportsRouter = Router();

function sendCsv(res: Response, name: string, body: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(body);
}

institutionReportsRouter.get(
  "/api/institution/reports/statement",
  requireAuth,
  async (req, res) => {
    const period = parsePeriod(req, res);
    if (!period) return;
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "view_reports", res)) return;
    try {
      const statement = await institutionStatement(db, ctx.institution.id, period.from, period.to);
      res.setHeader("Cache-Control", "private, no-store");
      if (period.format === "csv") {
        sendCsv(res, `${ctx.institution.slug}-statement.csv`, statementCsv(statement));
        return;
      }
      res.json({ institution: ctx.institution.slug, statement });
    } catch (err) {
      logger.warn({ err }, "custody: statement failed");
      res.status(500).json({ error: "Couldn't build the statement.", code: "INTERNAL" });
    }
  },
);

institutionReportsRouter.get("/api/institution/reports/audit", requireAuth, async (req, res) => {
  const period = parsePeriod(req, res);
  if (!period) return;
  const ctx = await memberContext(req, res);
  if (!ctx || !allow(ctx, "view_reports", res)) return;
  try {
    const rows = await institutionAuditRows(db, ctx.institution.id, period.from, period.to);
    res.setHeader("Cache-Control", "private, no-store");
    if (period.format === "csv") {
      sendCsv(res, `${ctx.institution.slug}-audit.csv`, auditCsv(rows));
      return;
    }
    res.json({ institution: ctx.institution.slug, period, rows });
  } catch (err) {
    logger.warn({ err }, "custody: audit export failed");
    res.status(500).json({ error: "Couldn't export the audit trail.", code: "INTERNAL" });
  }
});

institutionReportsRouter.get(
  "/api/institution/reports/reconciliation",
  requireAuth,
  async (req, res) => {
    const ctx = await memberContext(req, res);
    if (!ctx || !allow(ctx, "view_reports", res)) return;
    try {
      const wallets = await reconcileInstitution(db, ctx.institution.id, BASE_CHAIN_ID);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ institution: ctx.institution.slug, at: new Date().toISOString(), wallets });
    } catch (err) {
      if (err instanceof CircleUnavailableError) {
        res.status(503).json({ error: err.message, code: "CIRCLE_UNAVAILABLE" });
        return;
      }
      logger.warn({ err }, "custody: reconciliation failed");
      res
        .status(502)
        .json({ error: "Couldn't reconcile against Circle.", code: "RECONCILE_FAILED" });
    }
  },
);
