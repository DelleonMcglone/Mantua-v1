import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db/client.ts";
import type { Activity } from "../db/schema/activity.ts";
import {
  ACTIVITY_KINDS,
  categoryOf,
  isActivityKind,
  listActivity,
  type ActivityKind,
} from "../lib/activity.ts";
import { getAgentWallet } from "../lib/agent-wallet.ts";
import { DEFAULT_CHAIN_ID } from "../lib/chains.ts";
import { logger } from "../lib/logger.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";
import { requireAuth } from "../middleware/auth.ts";
import { walletRateLimiter } from "../middleware/rate-limit.ts";

/**
 * Phase 9 / PF-019 — GET /api/activity: the user's timeline, newest first,
 * cursor-paged. Rows match the user's id, their connected wallet, and
 * their agent wallet, so user trades, agent trades, hedges and settlements
 * appear in one feed. Entries carry `status` (pending | completed |
 * failed) and `actor` (user | agent | system); the client renders the
 * verification link from `txHash` with no chain branding (PF-018).
 */
export interface ActivityRouteDeps {
  list: typeof listActivity;
  resolveUser: (privyUserId: string) => Promise<string | null>;
  agentWalletAddress: (privyUserId: string) => Promise<string | null>;
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.iso.datetime().optional(),
  kind: z.string().optional(),
  actor: z.enum(["user", "agent", "system"]).optional(),
});

export interface ActivityDto {
  id: string;
  kind: ActivityKind;
  category: ReturnType<typeof categoryOf>;
  status: string;
  actor: string;
  summary: string;
  asset: string | null;
  amountRaw: string | null;
  valueUsd: number | null;
  marketId: string | null;
  poolId: string | null;
  positionRef: string | null;
  txHash: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function toActivityDto(row: Activity): ActivityDto {
  const kind: ActivityKind = isActivityKind(row.kind) ? row.kind : "swap";
  return {
    id: row.id,
    kind,
    category: categoryOf(kind),
    status: row.status,
    actor: row.actor,
    summary: row.summary,
    asset: row.asset,
    amountRaw: row.amountRaw,
    valueUsd: row.valueUsd === null ? null : Number(row.valueUsd),
    marketId: row.marketId,
    poolId: row.poolId,
    positionRef: row.positionRef,
    txHash: row.txHash,
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createActivityRouter(overrides: Partial<ActivityRouteDeps> = {}): Router {
  const deps: ActivityRouteDeps = {
    list: overrides.list ?? listActivity,
    resolveUser: overrides.resolveUser ?? ((privyUserId) => resolveUserId(db, privyUserId)),
    agentWalletAddress:
      overrides.agentWalletAddress ??
      (async (privyUserId) =>
        (await getAgentWallet(privyUserId, DEFAULT_CHAIN_ID))?.address ?? null),
  };
  const router = Router();

  router.get(
    "/api/activity",
    walletRateLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
      const privyUserId = req.privyUserId;
      if (!privyUserId) {
        res.status(401).json({ error: "Authentication required.", code: "UNAUTHENTICATED" });
        return;
      }
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid query", code: "BAD_REQUEST", details: parsed.error.issues });
        return;
      }
      const kinds = parsed.data.kind
        ? parsed.data.kind.split(",").filter(isActivityKind)
        : undefined;
      if (parsed.data.kind && (!kinds || kinds.length === 0)) {
        res.status(400).json({
          error: `Unknown kind; expected one of ${ACTIVITY_KINDS.join(", ")}`,
          code: "BAD_REQUEST",
        });
        return;
      }
      try {
        const [userId, agentAddress] = await Promise.all([
          deps.resolveUser(privyUserId),
          deps.agentWalletAddress(privyUserId).catch(() => null),
        ]);
        const walletAddresses = [req.walletAddress, agentAddress].filter(
          (a): a is string => typeof a === "string" && a.length > 0,
        );
        const rows = await deps.list(db, {
          userId,
          walletAddresses,
          ...(kinds ? { kinds } : {}),
          ...(parsed.data.actor ? { actor: parsed.data.actor } : {}),
          ...(parsed.data.before ? { before: parsed.data.before } : {}),
          limit: parsed.data.limit ?? 40,
        });
        const items = rows.map(toActivityDto);
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
          items,
          nextBefore:
            items.length === (parsed.data.limit ?? 40) ? (items.at(-1)?.createdAt ?? null) : null,
        });
      } catch (err) {
        logger.warn({ err }, "activity: list failed");
        res.status(500).json({ error: "Failed to load activity", code: "INTERNAL" });
      }
    },
  );

  return router;
}

export const activityRouter = createActivityRouter();
