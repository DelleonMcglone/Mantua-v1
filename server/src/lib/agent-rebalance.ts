import { and, eq } from "drizzle-orm";
import { type Address, formatUnits, parseAbi } from "viem";
import { db } from "../db/client.ts";
import { agentWallets, type AgentWallet } from "../db/schema/agent.ts";
import { users } from "../db/schema/users.ts";
import { logger } from "./logger.ts";
import { logAudit } from "./audit.ts";
import { getAgentWallet, AgentWalletNotFoundError } from "./agent-wallet.ts";
import { swapFromAgentWallet } from "./agent-swap.ts";
import { getTradeSignals, SIGNAL_THRESHOLDS, type PegInfo } from "./agent-signals.ts";
import { baseRpcClient } from "./rpc-client.ts";
import { getToken, type TokenSymbol } from "./tokens.ts";
import { tokenAmountUsd } from "./usd-pricing.ts";

/**
 * Autonomous peg "de-peg exit" rebalancing (Phase 2).
 *
 * For each opted-in agent wallet: if a held stablecoin (USDC/EURC) drifts beyond
 * the peg threshold, swap it into the on-peg reference (the least-drifting
 * stable). Each candidate swap is gated by getTradeSignals (acquired asset must
 * be on-peg, price impact under the limit) and clamped to a per-run USD ceiling
 * on top of the daily spending cap. Every action is audited; one agent's
 * failure never aborts the sweep.
 */

const STABLES: readonly TokenSymbol[] = ["USDC", "EURC"];
/** Per-swap USD ceiling — defense-in-depth under the daily spending cap. */
const MAX_REBALANCE_USD_PER_RUN = 100;
/** Skip dust positions. */
const MIN_REBALANCE_USD = 1;

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export interface RebalanceAction {
  agent: string;
  from: TokenSymbol;
  to: TokenSymbol;
  outcome: "rebalanced" | "skipped" | "error";
  reason: string;
  txHash?: string;
}

export interface RebalanceSummary {
  checkedAgents: number;
  rebalanced: number;
  skipped: number;
  errors: number;
  actions: RebalanceAction[];
}

/** The on-peg reference to exit into: the stable with the smallest |deviation|. */
function chooseSafeAsset(pegBy: Record<string, PegInfo | undefined>): TokenSymbol {
  let best: TokenSymbol = "USDC";
  let bestDev = Number.POSITIVE_INFINITY;
  for (const s of STABLES) {
    const p = pegBy[s];
    if (!p) continue;
    const dev = Math.abs(p.deviationPct);
    if (dev < bestDev) {
      bestDev = dev;
      best = s;
    }
  }
  return best;
}

async function balanceOf(symbol: TokenSymbol, owner: Address): Promise<bigint> {
  const t = getToken(symbol);
  if (t.native) return baseRpcClient.getBalance({ address: owner });
  return baseRpcClient.readContract({
    address: t.address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
}

export async function runAutoRebalance(): Promise<RebalanceSummary> {
  const agents = await db
    .select({ privyUserId: users.privyUserId, address: agentWallets.address })
    .from(agentWallets)
    .innerJoin(users, eq(agentWallets.userId, users.id))
    .where(and(eq(agentWallets.status, "active"), eq(agentWallets.rebalanceEnabled, true)));

  const summary: RebalanceSummary = {
    checkedAgents: 0,
    rebalanced: 0,
    skipped: 0,
    errors: 0,
    actions: [],
  };

  // Peg deviations are per-token (global), so fetch once for the whole sweep.
  const signals = await getTradeSignals({});
  const pegBy: Record<string, PegInfo | undefined> = {};
  for (const p of signals.pegs) pegBy[p.symbol] = p;
  const safe = chooseSafeAsset(pegBy);

  for (const a of agents) {
    summary.checkedAgents++;
    const agentAddr = a.address as Address;
    try {
      for (const sym of STABLES) {
        if (sym === safe) continue;
        const peg = pegBy[sym];
        if (!peg) continue;
        if (Math.abs(peg.deviationPct) <= SIGNAL_THRESHOLDS.maxPegDeviationPct) {
          summary.skipped++;
          summary.actions.push({
            agent: agentAddr,
            from: sym,
            to: safe,
            outcome: "skipped",
            reason: "on peg",
          });
          continue;
        }

        const balRaw = await balanceOf(sym, agentAddr);
        if (balRaw <= 0n) {
          summary.skipped++;
          continue;
        }
        const t = getToken(sym);
        const usd = await tokenAmountUsd(sym, balRaw);
        if (usd < MIN_REBALANCE_USD) {
          summary.skipped++;
          continue;
        }

        // Clamp the swapped amount to the per-run USD ceiling (integer math).
        let amountRaw = balRaw;
        if (usd > MAX_REBALANCE_USD_PER_RUN) {
          const fracPpm = BigInt(Math.floor((MAX_REBALANCE_USD_PER_RUN / usd) * 1_000_000));
          amountRaw = (balRaw * fracPpm) / 1_000_000n;
        }
        const amountIn = formatUnits(amountRaw, t.decimals);

        // Pre-trade gate: acquired asset on-peg + price impact under the limit.
        const tradeSig = await getTradeSignals({ tokenIn: sym, tokenOut: safe, amountIn });
        if (!tradeSig.verdict.ok) {
          summary.skipped++;
          summary.actions.push({
            agent: agentAddr,
            from: sym,
            to: safe,
            outcome: "skipped",
            reason: tradeSig.verdict.reasons.join("; ") || "signal gate",
          });
          continue;
        }

        const res = await swapFromAgentWallet({
          privyUserId: a.privyUserId,
          tokenIn: sym,
          tokenOut: safe,
          amountIn,
        });
        summary.rebalanced++;
        summary.actions.push({
          agent: agentAddr,
          from: sym,
          to: safe,
          outcome: "rebalanced",
          reason: `peg ${peg.deviationPct.toFixed(2)}% off`,
          txHash: res.txHash,
        });
        await logAudit({
          walletAddress: agentAddr,
          action: "agent_swap",
          outcome: "success",
          txHash: res.txHash,
          params: {
            triggerSource: "auto_rebalance",
            tokenIn: sym,
            tokenOut: safe,
            amountIn,
            pegDeviationPct: peg.deviationPct,
            usdValue: res.usdValue,
          },
        });
      }
    } catch (err) {
      summary.errors++;
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn({ err, agent: agentAddr }, "auto-rebalance: agent failed");
      summary.actions.push({ agent: agentAddr, from: "USDC", to: safe, outcome: "error", reason });
      await logAudit({
        walletAddress: agentAddr,
        action: "agent_swap",
        outcome: "failure",
        params: { triggerSource: "auto_rebalance", error: reason },
      });
    }
  }

  return summary;
}

/** Toggle a user's agent-wallet auto-rebalance opt-in. */
export async function setAutoRebalance(
  privyUserId: string,
  enabled: boolean,
): Promise<AgentWallet> {
  const wallet = await getAgentWallet(privyUserId);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);
  const updated = await db
    .update(agentWallets)
    .set({ rebalanceEnabled: enabled, updatedAt: new Date() })
    .where(eq(agentWallets.id, wallet.id))
    .returning();
  return updated[0];
}
