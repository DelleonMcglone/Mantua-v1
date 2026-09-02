import { z } from "zod";
import { isSupportedChainId } from "../lib/chains.ts";

/**
 * Two input modes:
 *   - `positionId` — UUID of a Mantua-tracked position in the DB
 *     (covers the legacy path: position created via the app on a
 *     network where Postgres reads are healthy).
 *   - `tokenId` — on-chain PositionManager ERC721 id (covers
 *     positions that exist on-chain + in localStorage but whose
 *     server-side record never landed; the calldata route verifies
 *     ownership via PositionManager.ownerOf and reads the position
 *     state from PositionManager.getPoolAndPositionInfo, so no DB
 *     pool/position row is required).
 * Exactly one must be provided.
 */
export const calldataSchema = z
  .object({
    positionId: z.uuid().optional(),
    tokenId: z.string().regex(/^\d+$/).optional(),
    /** The position's pool hook address — needed to pick the right
     *  per-hook PositionManager when resolving a tokenId (tokenIds aren't
     *  unique across PMs). Null/omitted = no-hook (hero) stack. */
    hookAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .nullable()
      .optional(),
    /** Target chain — omitted means Base (back-compat). */
    chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
    /** Percentage 1..100 (whole numbers). */
    percentage: z.number().int().min(1).max(100),
    slippageBps: z.number().int().min(0).max(500).default(50),
    deadlineSeconds: z.number().int().positive(),
  })
  .refine(
    (v) => (v.positionId ? 1 : 0) + (v.tokenId ? 1 : 0) === 1,
    "Exactly one of positionId or tokenId is required.",
  );

export const recordSchema = z
  .object({
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    positionId: z.uuid().optional(),
    tokenId: z.string().regex(/^\d+$/).optional(),
    liquidityRemoved: z.string().regex(/^\d+$/),
    isFullExit: z.boolean(),
    outcome: z.enum(["success", "failure"]),
  })
  .refine(
    (v) => (v.positionId ? 1 : 0) + (v.tokenId ? 1 : 0) === 1,
    "Exactly one of positionId or tokenId is required.",
  );
