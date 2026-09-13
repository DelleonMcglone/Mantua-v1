import { desc, eq, isNotNull } from "drizzle-orm";
import { parseAbi } from "viem";
import { db } from "../../db/client.ts";
import { events, leagues, marketFills, markets } from "../../db/schema/index.ts";
import { getRpcClient } from "../rpc-client.ts";
import { sharedCache } from "../shared-cache.ts";
import { BASE_CHAIN_ID } from "../chains.ts";
import {
  MARKETS_BY_CHAIN,
  MARKETS_PERIPHERY_BY_CHAIN,
  STATE_VIEW_ABI,
} from "../markets-contracts.ts";
import { sqrtPriceX96ToProbability } from "../probability.ts";

/**
 * A wallet's outcome-token positions across recent markets, marked at the
 * live pool price (B6-009), with avg-cost basis and unrealized P&L from
 * indexed fills. Lifted out of `routes/market-positions.ts` in task 056 so
 * the agent's `mantua_get_position` / `mantua_get_portfolio` read the same
 * computation — and the same cache — the user's portfolio does (A-011,
 * A-023, A-024).
 *
 * Phase 7 / R-007 — ~3 RPC reads per market row (two balances + slot0), so
 * one computation per wallet per window is shared across instances; a
 * verified fill for the wallet invalidates it (market-fills.ts) so the
 * number moves the moment the trade lands.
 */
export const POSITIONS_CACHE_MS = 10_000;
export function positionsCacheKey(owner: string): string {
  return `positions:${owner.toLowerCase()}`;
}

const BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

export interface MarketPositionRow {
  marketId: string;
  /** 0 = the home team's market, 1 = the away team's (task 056 — the agent
   *  needs it to build an exit simulation; the UI ignores it). */
  outcomeIndex: number;
  label: string;
  state: string;
  startsAt: number;
  side: "yes" | "no";
  balance: string;
  /** Current implied probability of THIS side paying out, in bps. */
  impliedProbBps: number | null;
  /** Mark value in USDC raw units (6dp): balance × side probability. */
  valueRaw: string;
  /** For the Close deep-link into the league page. */
  league: string | null;
  providerEventId: string | null;
  /** Average entry price in bps, from indexed fills (YES side only). */
  entryPriceBps: number | null;
  /** Unrealized P&L in USDC raw units: mark value − avg-cost basis. */
  pnlRaw: string | null;
  /** PF-003 — what this side pays at par if it wins (balance × 1 USDC), raw 6dp. */
  potentialPayoutRaw: string;
}

type Deployment = (typeof MARKETS_BY_CHAIN)[typeof BASE_CHAIN_ID];
type Periphery = (typeof MARKETS_PERIPHERY_BY_CHAIN)[typeof BASE_CHAIN_ID];

/** The cached read every caller should use (route and agent alike). */
export async function readMarketPositions(owner: `0x${string}`): Promise<MarketPositionRow[]> {
  const client = getRpcClient(BASE_CHAIN_ID);
  // Markets deployment is env-driven (Base Mainnet deployment pending —
  // see docs/tasks/v2-roadmap.md); without it, balances still report but
  // positions stay unmarked.
  const deployment = MARKETS_BY_CHAIN[BASE_CHAIN_ID];
  const periphery = MARKETS_PERIPHERY_BY_CHAIN[BASE_CHAIN_ID];
  return sharedCache.getOrCompute(positionsCacheKey(owner), POSITIONS_CACHE_MS, () =>
    computeMarketPositions(owner, client, deployment, periphery),
  );
}

export async function computeMarketPositions(
  owner: `0x${string}`,
  client: ReturnType<typeof getRpcClient>,
  deployment: Deployment,
  periphery: Periphery,
): Promise<MarketPositionRow[]> {
  const rows = await db
    .select({
      marketId: markets.marketId,
      outcomeIndex: markets.outcomeIndex,
      state: markets.state,
      yesToken: markets.yesToken,
      noToken: markets.noToken,
      poolId: markets.poolId,
      startsAt: events.startsAt,
      homeTeam: events.homeTeam,
      awayTeam: events.awayTeam,
      providerEventId: events.providerEventId,
      league: leagues.slug,
    })
    .from(markets)
    .innerJoin(events, eq(markets.eventId, events.id))
    .innerJoin(leagues, eq(events.leagueId, leagues.id))
    .where(isNotNull(markets.yesToken))
    .orderBy(desc(markets.createdAt))
    .limit(40);

  // Avg-cost basis per market from indexed fills (YES-side trades).
  const fills = await db
    .select()
    .from(marketFills)
    .where(eq(marketFills.address, owner.toLowerCase()));
  const basis = new Map<string, { tokens: bigint; usdc: bigint }>();
  for (const f of fills) {
    const b = basis.get(f.marketId) ?? { tokens: 0n, usdc: 0n };
    if (f.direction === "buy") {
      b.tokens += BigInt(f.tokensRaw);
      b.usdc += BigInt(f.usdcRaw);
    } else if (b.tokens > 0n) {
      // Selling reduces basis at average cost.
      const sold = BigInt(f.tokensRaw) > b.tokens ? b.tokens : BigInt(f.tokensRaw);
      b.usdc -= (b.usdc * sold) / b.tokens;
      b.tokens -= sold;
    }
    basis.set(f.marketId, b);
  }

  const positions: MarketPositionRow[] = [];
  await Promise.all(
    rows.map(async (row) => {
      if (!row.yesToken || !row.noToken) return;
      const [yesBal, noBal] = await Promise.all([
        client.readContract({
          address: row.yesToken as `0x${string}`,
          abi: BALANCE_ABI,
          functionName: "balanceOf",
          args: [owner],
        }),
        client.readContract({
          address: row.noToken as `0x${string}`,
          abi: BALANCE_ABI,
          functionName: "balanceOf",
          args: [owner],
        }),
      ]);
      if (yesBal === 0n && noBal === 0n) return;

      let yesProbBps: number | null = null;
      if (row.poolId && deployment && periphery) {
        try {
          const [sqrtPriceX96] = await client.readContract({
            address: periphery.stateView,
            abi: STATE_VIEW_ABI,
            functionName: "getSlot0",
            args: [row.poolId as `0x${string}`],
          });
          if (sqrtPriceX96 > 0n) {
            const yesIsToken0 = row.yesToken.toLowerCase() < deployment.collateral.toLowerCase();
            yesProbBps = Math.round(sqrtPriceX96ToProbability(sqrtPriceX96, yesIsToken0) * 10_000);
          }
        } catch {
          // price unavailable — report the balance unmarked
        }
      }

      const winner = row.outcomeIndex === 0 ? row.homeTeam : row.awayTeam;
      const opponent = row.outcomeIndex === 0 ? row.awayTeam : row.homeTeam;
      const label = `${winner} to beat ${opponent}`;

      for (const [side, bal] of [
        ["yes", yesBal],
        ["no", noBal],
      ] as const) {
        if (bal === 0n) continue;
        const sideProb =
          yesProbBps === null ? null : side === "yes" ? yesProbBps : 10_000 - yesProbBps;
        const valueRaw = sideProb === null ? "0" : ((bal * BigInt(sideProb)) / 10_000n).toString();

        // Entry/P&L only for the YES side, where fills are indexed.
        let entryPriceBps: number | null = null;
        let pnlRaw: string | null = null;
        const b = side === "yes" ? basis.get(row.marketId) : undefined;
        if (b && b.tokens > 0n && sideProb !== null) {
          entryPriceBps = Number((b.usdc * 10_000n) / b.tokens);
          const held = bal < b.tokens ? bal : b.tokens;
          const costOfHeld = (b.usdc * held) / b.tokens;
          const markOfHeld = (held * BigInt(sideProb)) / 10_000n;
          pnlRaw = (markOfHeld - costOfHeld).toString();
        }

        positions.push({
          marketId: row.marketId,
          outcomeIndex: row.outcomeIndex,
          label,
          state: row.state,
          startsAt: Math.floor(new Date(row.startsAt).getTime() / 1000),
          side,
          balance: bal.toString(),
          impliedProbBps: sideProb,
          valueRaw,
          league: row.league,
          providerEventId: row.providerEventId,
          entryPriceBps,
          pnlRaw,
          potentialPayoutRaw: bal.toString(),
        });
      }
    }),
  );

  positions.sort((a, b) => b.startsAt - a.startsAt);
  return positions;
}
