import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { pools, positions } from "../db/schema/trading.ts";
import { users } from "../db/schema/users.ts";
import { logger } from "../lib/logger.ts";
import { loadExternalPositions } from "../lib/external-positions.ts";
import { readOnchainPositions } from "../lib/v4-onchain-positions.ts";
import {
  DEFAULT_CHAIN_ID,
  isSupportedChainId,
  type SupportedChainId,
} from "../lib/chains.ts";
import { requireAuth } from "../middleware/auth.ts";

export const positionsRouter = Router();

function readChainId(req: Request): SupportedChainId {
  const raw = req.query.chainId;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (isSupportedChainId(n)) return n;
  }
  return DEFAULT_CHAIN_ID;
}

/**
 * Authoritative LP positions for the connected wallet, read straight from
 * the chain (PositionManager NFTs across every Mantua hook stack). Unlike
 * `/api/positions` this needs no DB rows or subgraph — it reflects on-chain
 * reality, so the Positions tab survives a cleared localStorage cache and
 * shows positions opened from anywhere.
 */
positionsRouter.get("/api/positions/onchain", requireAuth, async (req: Request, res: Response) => {
  if (!req.walletAddress) {
    res.json({ positions: [] });
    return;
  }
  try {
    const chainId = readChainId(req);
    const onchain = await readOnchainPositions(req.walletAddress as `0x${string}`, chainId);
    res.json({ positions: onchain });
  } catch (err) {
    logger.error({ err }, "GET /api/positions/onchain failed");
    res.status(502).json({ error: "Failed to read on-chain positions", code: "UPSTREAM_FAILURE" });
  }
});

/**
 * P4-009 — list the user's open positions. Mantua-opened rows come from
 * the positions table; pre-Mantua v4 positions are discovered via the
 * v4 subgraph (P4e-003) and enriched with PositionManager view calls.
 * Subgraph and RPC failures degrade to "Mantua-only" rather than 500.
 */
positionsRouter.get("/api/positions", requireAuth, async (req: Request, res: Response) => {
  if (!req.privyUserId) {
    res.status(401).json({ error: "Auth required", code: "UNAUTHENTICATED" });
    return;
  }
  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.privyUserId, req.privyUserId))
      .limit(1);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty for an unknown user
    if (!user) {
      res.json({ positions: [] });
      return;
    }
    const dbRows = await db
      .select({
        id: positions.id,
        tokenId: positions.tokenId,
        tickLower: positions.tickLower,
        tickUpper: positions.tickUpper,
        liquidity: positions.liquidity,
        status: positions.status,
        openedTx: positions.openedTx,
        closedTx: positions.closedTx,
        createdAt: positions.createdAt,
        poolKeyHash: pools.poolKeyHash,
        token0: pools.token0,
        token1: pools.token1,
        fee: pools.fee,
        tickSpacing: pools.tickSpacing,
        hookAddress: pools.hookAddress,
      })
      .from(positions)
      .innerJoin(pools, eq(positions.poolId, pools.id))
      .where(and(eq(positions.userId, user.id), eq(positions.status, "open")))
      .orderBy(desc(positions.createdAt));

    const externalRows = req.walletAddress
      ? await loadExternalPositions(req.walletAddress, {
          excludeTokenIds: new Set(
            dbRows.map((r) => r.tokenId).filter((id): id is string => id !== null),
          ),
        })
      : [];

    const merged = [...dbRows, ...externalRows].sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    );
    res.json({ positions: merged });
  } catch (err) {
    logger.error({ err }, "GET /api/positions failed");
    res.status(500).json({ error: "Failed to load positions", code: "INTERNAL" });
  }
});
