/**
 * Task 044 (D-104 / P-010) — the internal resolution ops surface.
 *
 * Three things, all operator-only, all behind the SAME internal-auth posture
 * as the crons (`requireCronSecret` — Bearer CRON_SECRET, 503 when unset):
 *
 *  - `GET  /api/ops/resolution` — the P-010 verifiability surface: every
 *    settlement row (txHash, signer, method, confidence state, source
 *    payload summary, dispute-window timestamps, BaseScan link) plus the
 *    pending review queue with window/hold state. This is internal ops
 *    only — the public user UI stays chainless by design.
 *  - `POST /api/ops/resolution/hold` / `release` — park / un-park a pending
 *    outcome against its dispute window. Mandatory note, audit row; while
 *    held, an elapsed window never submits (executeResolution checks it).
 *  - `POST /api/ops/resolution/override` — the audited manual override:
 *    method `manual`, mandatory note, executed through the SAME submitter
 *    machinery as the automated sweep (`liveResolutionSubmitter` — the
 *    address-routed Resolver signer), recorded in the same `resolutions`
 *    table with the tx hash. Refuses when the market is not in a resolvable
 *    state. Raw-EOA overrides outside this path are recovery-only and get
 *    reconciled into the same tables after the fact (D-104).
 *
 * Dependency-injected via `createResolutionOpsRouter` so route tests fake
 * the store and submitter at these seams; the exported `resolutionOpsRouter`
 * wires the real drizzle store and on-chain submitter.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { logAudit } from "../lib/audit.ts";
import { BASESCAN_WEB } from "../lib/basescan.ts";
import { BASE_CHAIN_ID, isSupportedChainId, type SupportedChainId } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { liveResolutionSubmitter } from "../lib/sports/markets-onchain.ts";
import {
  authorizeManualOverride,
  type ManualOverrideEvidence,
} from "../lib/sports/resolution-criteria.ts";
import {
  drizzleResolutionLog,
  drizzleResolutionOpsStore,
  type ResolutionOpsStore,
} from "../lib/sports/resolution-store.ts";
import type { ResolutionLogWriter, ResolutionSubmitter } from "../lib/sports/resolution.ts";
import { requireCronSecret } from "../middleware/cron-auth.ts";

export interface ResolutionOpsDeps {
  store: ResolutionOpsStore;
  submitterFor: (chainId: SupportedChainId) => ResolutionSubmitter | null;
  logFor: (chainId: SupportedChainId) => ResolutionLogWriter;
  now: () => Date;
}

const chainIdSchema = z
  .number()
  .int()
  .refine(isSupportedChainId, "Unsupported chainId")
  .optional();

const holdSchema = z.object({
  providerEventId: z.string().min(1).max(128),
  /** Mandatory operator justification (D-104). */
  note: z.string().trim().min(1).max(2000),
  chainId: chainIdSchema,
});

const overrideSchema = z
  .object({
    marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    action: z.enum(["resolve", "void"]),
    /** Market vocabulary: 0 = this market's YES won, 1 = its NO won. */
    outcome: z.union([z.literal(0), z.literal(1)]).optional(),
    /** Mandatory operator justification (D-104). */
    note: z.string().trim().min(1).max(2000),
    chainId: chainIdSchema,
  })
  .refine((v) => v.action !== "resolve" || v.outcome !== undefined, {
    message: "outcome (0|1) is required for action \"resolve\"",
    path: ["outcome"],
  });

/** Market states an operator override may act on. RESOLVED/SETTLED/INVALID
 *  markets are already settled — overriding them would double-resolve. */
const RESOLVABLE_STATES = new Set(["OPEN", "FROZEN"]);

/** Compact, human-scannable digest of a `source_payload` bundle. */
export function summarizeSourcePayload(payload: unknown): Record<string, unknown> | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p["schema"] !== "resolution-evidence@1") {
    return { keys: Object.keys(p).slice(0, 12) };
  }
  const criteria = Array.isArray(p["criteria"]) ? (p["criteria"] as { pass?: boolean }[]) : null;
  const consensus = p["consensus"] as Record<string, unknown> | undefined;
  return {
    schema: p["schema"],
    ...(typeof p["kind"] === "string" ? { kind: p["kind"] } : {}),
    providerEventId: p["providerEventId"] ?? null,
    ...(typeof p["policy"] === "string" ? { policy: p["policy"] } : {}),
    ...(consensus && typeof consensus["kind"] === "string"
      ? { consensus: consensus["kind"] }
      : {}),
    ...(criteria
      ? { criteriaPassed: criteria.filter((c) => c.pass === true).length, criteriaTotal: criteria.length }
      : {}),
    ...(typeof p["note"] === "string" ? { note: p["note"] } : {}),
    decidedAt: p["decidedAt"] ?? null,
  };
}

export function createResolutionOpsRouter(overrides: Partial<ResolutionOpsDeps> = {}): Router {
  const deps: ResolutionOpsDeps = {
    store: overrides.store ?? drizzleResolutionOpsStore(db),
    submitterFor: overrides.submitterFor ?? liveResolutionSubmitter,
    logFor: overrides.logFor ?? ((chainId) => drizzleResolutionLog(db, chainId)),
    now: overrides.now ?? (() => new Date()),
  };
  const router = Router();

  // ── P-010 — list/inspect resolutions + the pending queue ───────────────
  router.get(
    "/api/ops/resolution",
    requireCronSecret,
    async (req: Request, res: Response) => {
      const rawLimit = Number(req.query["limit"] ?? 50);
      const limit = Number.isInteger(rawLimit) && rawLimit > 0 && rawLimit <= 200 ? rawLimit : 50;
      const chainId = BASE_CHAIN_ID;
      try {
        const [rows, pending] = await Promise.all([
          deps.store.listResolutions(limit),
          deps.store.listPending(chainId, limit),
        ]);
        res.json({
          disputeWindowSeconds: env.RESOLUTION_DISPUTE_WINDOW_SECONDS,
          resolutions: rows.map((r) => ({
            id: r.id,
            marketId: r.marketId,
            method: r.method,
            winningOutcomeIndex: r.winningOutcomeIndex,
            source: r.source,
            signer: r.signer,
            txHash: r.txHash,
            explorerUrl: r.txHash ? `${BASESCAN_WEB}/tx/${r.txHash}` : null,
            confidenceState: r.confidenceState,
            note: r.note,
            disputeWindow:
              r.disputeWindowOpensAt && r.disputeWindowClosesAt
                ? { opensAt: r.disputeWindowOpensAt, closesAt: r.disputeWindowClosesAt }
                : null,
            sourcePayloadSummary: summarizeSourcePayload(r.sourcePayload),
            createdAt: r.createdAt,
          })),
          pending: pending.map((p) => ({
            providerEventId: p.providerEventId,
            chainId: p.chainId,
            state: p.state,
            policy: p.policy,
            reason: p.reason,
            winningOutcomeIndex: p.winningOutcomeIndex,
            disputeWindow:
              p.disputeWindowOpensAt && p.disputeWindowClosesAt
                ? { opensAt: p.disputeWindowOpensAt, closesAt: p.disputeWindowClosesAt }
                : null,
            operatorHold: p.operatorHoldAt
              ? { at: p.operatorHoldAt, note: p.operatorHoldNote }
              : null,
            firstFinalSeenAt: p.firstFinalSeenAt,
            updatedAt: p.updatedAt,
          })),
        });
      } catch (err) {
        logger.error({ err }, "resolution-ops: list failed");
        res.status(500).json({ error: "Failed to list resolutions", code: "INTERNAL" });
      }
    },
  );

  // ── D-104 — operator hold / release ────────────────────────────────────
  router.post(
    "/api/ops/resolution/hold",
    requireCronSecret,
    async (req: Request, res: Response) => {
      const parsed = holdSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
        return;
      }
      const { providerEventId, note } = parsed.data;
      const chainId = parsed.data.chainId ?? BASE_CHAIN_ID;
      const at = deps.now();
      const result = await deps.store.setHold(providerEventId, chainId, note, at);
      if (result === "not_found") {
        res.status(404).json({
          error: "No resolution review exists for that event — nothing to hold",
          code: "REVIEW_NOT_FOUND",
        });
        return;
      }
      await logAudit({
        action: "market_resolution",
        outcome: "success",
        reason: `operator hold set: ${note}`,
        params: { providerEventId, op: "hold" },
        chainId,
      });
      res.json({ ok: true, providerEventId, chainId, heldAt: at.toISOString() });
    },
  );

  router.post(
    "/api/ops/resolution/release",
    requireCronSecret,
    async (req: Request, res: Response) => {
      const parsed = holdSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
        return;
      }
      const { providerEventId, note } = parsed.data;
      const chainId = parsed.data.chainId ?? BASE_CHAIN_ID;
      const result = await deps.store.clearHold(providerEventId, chainId, deps.now());
      if (result === "not_found") {
        res.status(404).json({
          error: "No resolution review exists for that event",
          code: "REVIEW_NOT_FOUND",
        });
        return;
      }
      if (result === "no_hold") {
        res
          .status(409)
          .json({ error: "That event carries no operator hold", code: "NO_HOLD" });
        return;
      }
      await logAudit({
        action: "market_resolution",
        outcome: "success",
        reason: `operator hold released: ${note}`,
        params: { providerEventId, op: "release" },
        chainId,
      });
      res.json({ ok: true, providerEventId, chainId });
    },
  );

  // ── D-104 — audited manual override ────────────────────────────────────
  router.post(
    "/api/ops/resolution/override",
    requireCronSecret,
    async (req: Request, res: Response) => {
      const parsed = overrideSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid request", code: "BAD_REQUEST", details: parsed.error.issues });
        return;
      }
      const { action, note } = parsed.data;
      const marketId = parsed.data.marketId as `0x${string}`;
      const chainId = parsed.data.chainId ?? BASE_CHAIN_ID;

      const submitter = deps.submitterFor(chainId);
      if (!submitter) {
        res.status(503).json({
          error: "Resolution submission disabled — no authorised signer key for this chain",
          code: "RESOLUTION_DISABLED",
        });
        return;
      }

      const ctx = await deps.store.marketContext(marketId);
      if (!ctx) {
        res.status(404).json({ error: "Unknown market", code: "MARKET_NOT_FOUND" });
        return;
      }
      if (!RESOLVABLE_STATES.has(ctx.state)) {
        res.status(409).json({
          error: `Market is ${ctx.state} — not in a resolvable state`,
          code: "MARKET_NOT_RESOLVABLE",
          state: ctx.state,
        });
        return;
      }

      const at = deps.now();
      try {
        // Same in-line freeze sweep as the automated executor: the Resolver
        // requires FROZEN before resolve/void, and freeze is idempotent.
        await submitter.freeze(marketId).catch(() => null);

        let txHash: string;
        let evidence: ManualOverrideEvidence;
        if (action === "resolve") {
          const outcome = parsed.data.outcome as 0 | 1;
          // The ONLY authorization mint outside the criteria gate — the
          // deliberate, note-carrying D-104 operator path.
          const auth = authorizeManualOverride({
            marketId,
            outcome,
            providerEventId: ctx.providerEventId,
            note,
            nowSeconds: Math.floor(at.getTime() / 1000),
          });
          txHash = await submitter.resolve(auth);
          evidence = auth.evidence;
        } else {
          txHash = await submitter.void(marketId);
          evidence = {
            schema: "resolution-evidence@1",
            kind: "manual-override",
            providerEventId: ctx.providerEventId,
            marketId,
            outcome: null,
            note,
            decidedAt: at.toISOString(),
          };
        }

        await deps.logFor(chainId).record({
          marketId,
          providerEventId: ctx.providerEventId ?? "",
          method: "manual",
          kind: action,
          outcome: action === "resolve" ? (parsed.data.outcome as number) : null,
          source: "operator",
          signer: submitter.signerAddress(),
          txHash,
          evidence,
          confidenceState: null,
          note,
        });
        // A manual RESOLVE settles the game's review too (the human act the
        // absorbing DISPUTED/MANUAL_REVIEW states wait for). A manual void
        // stays confidence-exempt, matching the automated pipeline (B4-005).
        if (action === "resolve" && ctx.providerEventId) {
          await deps.store.markManuallyResolved(ctx.providerEventId, chainId, txHash, note, at);
        }
        await logAudit({
          action: "market_resolution",
          outcome: "success",
          reason: `manual override (${action}): ${note}`,
          params: {
            marketId,
            op: "override",
            kind: action,
            outcome: action === "resolve" ? parsed.data.outcome : null,
            providerEventId: ctx.providerEventId,
          },
          txHash,
          chainId,
        });
        res.json({
          ok: true,
          marketId,
          kind: action,
          txHash,
          explorerUrl: `${BASESCAN_WEB}/tx/${txHash}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, marketId, action }, "resolution-ops: manual override failed");
        await logAudit({
          action: "market_resolution",
          outcome: "failure",
          reason: `manual override (${action}) failed: ${message}`,
          params: { marketId, op: "override", kind: action },
          chainId,
        });
        res.status(502).json({ error: message, code: "SUBMIT_FAILED" });
      }
    },
  );

  return router;
}

export const resolutionOpsRouter = createResolutionOpsRouter();
