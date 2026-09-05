import { Router, type Request, type Response } from "express";
import { asc, desc, eq, inArray, isNotNull, isNull, and } from "drizzle-orm";
import { parseAbi } from "viem";
import { z } from "zod";
import { db } from "../db/client.ts";
import { events, leagues, marketPositions, markets, resolutions } from "../db/schema/index.ts";
import { logAudit } from "../lib/audit.ts";
import { logger } from "../lib/logger.ts";
import { requireAuth } from "../middleware/auth.ts";
import { writeRateLimiter } from "../middleware/rate-limit.ts";
import { getRpcClient } from "../lib/rpc-client.ts";
import { getRequestContext } from "../lib/request-context.ts";
import { BASE_CHAIN_ID, DEFAULT_CHAIN_ID, isSupportedChainId } from "../lib/chains.ts";
import { MARKETS_BY_CHAIN, MARKET_ABI, MARKET_FACTORY_ABI } from "../lib/markets-contracts.ts";
import {
  estimatePayoutRaw,
  redeemCalldata,
  redeemFunctionForOnchainState,
  redeemableSides,
} from "../lib/sports/market-redeem.ts";

export const marketRedeemRouter = Router();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/** `winningOutcome` is a public var on Market.sol — not in the shared
 *  MARKET_ABI (the sweep never needs it), so declared locally. */
const WINNING_OUTCOME_ABI = parseAbi(["function winningOutcome() view returns (uint8)"]);

export interface RedeemableRow {
  marketId: string;
  /** e.g. "Chiefs to beat Raiders". */
  label: string;
  league: string | null;
  providerEventId: string | null;
  /** RESOLVED | SETTLED | INVALID. */
  state: string;
  side: "yes" | "no";
  tokenAddress: string;
  balanceRaw: string;
  /** Estimated USDC payout, raw 6dp units ($1/winning share, $0.50 on INVALID). */
  payoutRaw: string;
}

/**
 * GET /api/markets/redeemable?address=0x… — the caller's claimable positions
 * (C-011 GAP-3): finished markets (RESOLVED/SETTLED/INVALID) where the
 * address still holds outcome tokens worth redeeming. Winning side only on a
 * resolved market; either side on a voided one.
 *
 * Balances are public chain data; auth is required anyway (same posture as
 * /api/markets/positions) so the endpoint can't enumerate wallets anonymously.
 * Until the markets deployment exists on Base Mainnet this returns an empty
 * list — there is nothing on-chain to redeem.
 */
marketRedeemRouter.get(
  "/api/markets/redeemable",
  requireAuth,
  async (req: Request, res: Response) => {
    const address = z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .safeParse(req.query.address);
    if (!address.success) {
      res.status(400).json({ error: "address required", code: "BAD_REQUEST" });
      return;
    }
    const owner = address.data as `0x${string}`;

    // Graceful degradation: no deployment → no on-chain markets → nothing
    // claimable. Empty list, not an error (the UI simply shows no claims).
    if (!MARKETS_BY_CHAIN[BASE_CHAIN_ID]) {
      res.json({ redeemable: [] });
      return;
    }

    try {
      const rows = await db
        .select({
          marketId: markets.marketId,
          outcomeIndex: markets.outcomeIndex,
          state: markets.state,
          yesToken: markets.yesToken,
          noToken: markets.noToken,
          homeTeam: events.homeTeam,
          awayTeam: events.awayTeam,
          providerEventId: events.providerEventId,
          league: leagues.slug,
        })
        .from(markets)
        .innerJoin(events, eq(markets.eventId, events.id))
        .innerJoin(leagues, eq(events.leagueId, leagues.id))
        .where(
          and(
            isNotNull(markets.yesToken),
            inArray(markets.state, ["RESOLVED", "SETTLED", "INVALID"]),
          ),
        )
        .orderBy(desc(markets.resolvedAt))
        .limit(60);

      // Winning outcome per market (market vocabulary: 0 = YES pays) from
      // the resolution log; later rows win so overrides supersede.
      const winnerByMarket = new Map<string, number>();
      if (rows.length > 0) {
        const resRows = await db
          .select({
            marketId: resolutions.marketId,
            winningOutcomeIndex: resolutions.winningOutcomeIndex,
          })
          .from(resolutions)
          .where(
            inArray(
              resolutions.marketId,
              rows.map((r) => r.marketId),
            ),
          )
          .orderBy(asc(resolutions.createdAt));
        for (const r of resRows) {
          if (r.winningOutcomeIndex !== null) {
            winnerByMarket.set(r.marketId, r.winningOutcomeIndex);
          }
        }
      }

      const client = getRpcClient(BASE_CHAIN_ID);
      const redeemable: RedeemableRow[] = [];
      await Promise.all(
        rows.map(async (row) => {
          if (!row.yesToken || !row.noToken) return;
          const [yesBal, noBal] = await Promise.all(
            [row.yesToken, row.noToken].map((t) =>
              client.readContract({
                address: t as `0x${string}`,
                abi: BALANCE_ABI,
                functionName: "balanceOf",
                args: [owner],
              }),
            ),
          );
          const sides = redeemableSides({
            state: row.state,
            winningOutcomeIndex: winnerByMarket.get(row.marketId) ?? null,
            yesBalanceRaw: yesBal,
            noBalanceRaw: noBal,
          });
          if (sides.length === 0) return;

          const winner = row.outcomeIndex === 0 ? row.homeTeam : row.awayTeam;
          const opponent = row.outcomeIndex === 0 ? row.awayTeam : row.homeTeam;
          const label = `${winner} to beat ${opponent}`;
          for (const s of sides) {
            redeemable.push({
              marketId: row.marketId,
              label,
              league: row.league,
              providerEventId: row.providerEventId,
              state: row.state,
              side: s.side,
              tokenAddress: s.side === "yes" ? row.yesToken : row.noToken,
              balanceRaw: s.balanceRaw.toString(),
              payoutRaw: s.payoutRaw.toString(),
            });
          }
        }),
      );

      res.json({ redeemable });
    } catch (err) {
      logger.warn({ err }, "market-redeem: redeemable listing failed");
      res.status(500).json({ error: "Failed to load claimable positions", code: "INTERNAL" });
    }
  },
);

const calldataBodySchema = z.object({
  marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  /** Execution chain — omitted means Base (back-compat). */
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

/**
 * POST /api/markets/redeem/calldata — the redemption call for one finished
 * market. The server builds, the USER signs (the market-trade pattern): this
 * route holds no keys and moves no funds. Redemption is an inflow — winnings
 * coming back to the user — so the spending cap is not involved.
 *
 * The function is picked from the market's LIVE on-chain state, mirroring
 * the operator sweep: state 4 (INVALID) → redeemInvalid, 2/3 → redeem.
 */
marketRedeemRouter.post(
  "/api/markets/redeem/calldata",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = calldataBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
      return;
    }
    const wallet = getRequestContext(req).walletAddress;
    if (!wallet) {
      res.status(401).json({ error: "Wallet not linked", code: "WALLET_REQUIRED" });
      return;
    }
    const chainId = parsed.data.chainId ?? DEFAULT_CHAIN_ID;
    const deployment = MARKETS_BY_CHAIN[chainId];
    if (!deployment) {
      res.status(400).json({ error: "Markets not deployed on this chain", code: "BAD_CHAIN" });
      return;
    }

    try {
      const known = await db
        .select({ marketId: markets.marketId })
        .from(markets)
        .where(eq(markets.marketId, parsed.data.marketId))
        .limit(1);
      if (known.length === 0) {
        res.status(404).json({ error: "Unknown market", code: "NO_MARKET" });
        return;
      }

      const client = getRpcClient(chainId);
      const market = await client.readContract({
        address: deployment.factory,
        abi: MARKET_FACTORY_ABI,
        functionName: "marketOf",
        args: [parsed.data.marketId as `0x${string}`],
      });
      if (market === ZERO_ADDRESS) {
        res.status(404).json({ error: "Unknown market", code: "NO_MARKET" });
        return;
      }

      const state = await client.readContract({
        address: market,
        abi: MARKET_ABI,
        functionName: "state",
      });
      const fn = redeemFunctionForOnchainState(state);
      if (fn === null) {
        res.status(409).json({
          error: "This market hasn't finished yet — winnings unlock once it settles.",
          code: "NOT_REDEEMABLE",
        });
        return;
      }

      // Verify the caller actually holds something the contract would pay
      // for; otherwise the signed call is a guaranteed NothingToRedeem revert.
      const [yesToken, noToken] = await Promise.all([
        client.readContract({ address: market, abi: MARKET_ABI, functionName: "yesToken" }),
        client.readContract({ address: market, abi: MARKET_ABI, functionName: "noToken" }),
      ]);
      let claimableRaw: bigint;
      if (fn === "redeemInvalid") {
        const [yesBal, noBal] = await Promise.all(
          [yesToken, noToken].map((t) =>
            client.readContract({
              address: t,
              abi: BALANCE_ABI,
              functionName: "balanceOf",
              args: [wallet as `0x${string}`],
            }),
          ),
        );
        claimableRaw = yesBal + noBal;
      } else {
        const winningOutcome = await client.readContract({
          address: market,
          abi: WINNING_OUTCOME_ABI,
          functionName: "winningOutcome",
        });
        claimableRaw = await client.readContract({
          address: winningOutcome === 0 ? yesToken : noToken,
          abi: BALANCE_ABI,
          functionName: "balanceOf",
          args: [wallet as `0x${string}`],
        });
      }
      if (claimableRaw === 0n) {
        res.status(409).json({
          error: "Nothing to claim in this market for this wallet.",
          code: "NOTHING_TO_REDEEM",
        });
        return;
      }

      res.json({
        to: market,
        calldata: redeemCalldata(fn),
        state,
        functionName: fn,
        payoutRaw: estimatePayoutRaw(fn, claimableRaw).toString(),
      });
    } catch (err) {
      logger.warn({ err, marketId: parsed.data.marketId }, "market-redeem: calldata failed");
      res.status(502).json({
        error: "Couldn't prepare the claim — try again shortly.",
        code: "REDEEM_BUILD_FAILED",
      });
    }
  },
);

const recordBodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  marketId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  /** Chain the redemption happened on — omitted means Base (back-compat). */
  chainId: z.number().int().refine(isSupportedChainId, "Unsupported chainId").optional(),
});

/**
 * POST /api/markets/redeem/record — stamp a confirmed redemption onto the
 * position mirror and the audit log (market-fills' trust-but-verify pattern):
 * the client reports its own tx, and the server checks the receipt before
 * believing it — the tx must exist, have succeeded, and target the market
 * contract for the claimed marketId. The stamped wallet is the tx SENDER,
 * not the caller's word.
 */
marketRedeemRouter.post(
  "/api/markets/redeem/record",
  requireAuth,
  writeRateLimiter,
  async (req: Request, res: Response) => {
    const parsed = recordBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid record", code: "BAD_REQUEST" });
      return;
    }
    const { txHash, marketId } = parsed.data;
    const chainId = parsed.data.chainId ?? DEFAULT_CHAIN_ID;
    const deployment = MARKETS_BY_CHAIN[chainId];
    if (!deployment) {
      res.status(400).json({ error: "Markets not deployed on this chain", code: "BAD_CHAIN" });
      return;
    }

    try {
      const client = getRpcClient(chainId);
      const [receipt, tx, market] = await Promise.all([
        client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
        client.getTransaction({ hash: txHash as `0x${string}` }),
        client.readContract({
          address: deployment.factory,
          abi: MARKET_FACTORY_ABI,
          functionName: "marketOf",
          args: [marketId as `0x${string}`],
        }),
      ]);
      if (receipt.status !== "success") {
        res.status(422).json({ error: "Transaction did not succeed", code: "TX_FAILED" });
        return;
      }
      if (market === ZERO_ADDRESS || tx.to?.toLowerCase() !== market.toLowerCase()) {
        res.status(422).json({ error: "Not a redemption of this market", code: "WRONG_TARGET" });
        return;
      }

      const walletAddress = tx.from.toLowerCase();
      await db
        .update(marketPositions)
        .set({ redeemedAt: new Date(), redeemTxHash: txHash.toLowerCase(), updatedAt: new Date() })
        .where(
          and(
            eq(marketPositions.marketId, marketId),
            eq(marketPositions.walletAddress, walletAddress),
            isNull(marketPositions.redeemedAt),
          ),
        );
      await logAudit({
        walletAddress,
        action: "market_redeem",
        outcome: "success",
        txHash: txHash.toLowerCase(),
        chainId,
        params: { marketId },
      });
      res.status(201).json({ ok: true });
    } catch (err) {
      logger.warn({ err, txHash }, "market-redeem: record verification failed");
      res.status(422).json({ error: "Couldn't verify the transaction", code: "VERIFY_FAILED" });
    }
  },
);
