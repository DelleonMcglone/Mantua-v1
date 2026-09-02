import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agentWallets } from "../db/schema/agent.ts";
import { dailyWalletSpend } from "../db/schema/safety.ts";
import { userPreferences } from "../db/schema/users.ts";
import { users } from "../db/schema/users.ts";
import { DEFAULT_DAILY_CAP_USD, HARD_DAILY_CAP_USD } from "./constants.ts";
import { SafetyError } from "./errors.ts";
import { logger } from "./logger.ts";

/**
 * Cap enforcement is ON by default on every network. Phase 5b-2 originally
 * keyed this off MANTUA_NETWORK (no-op unless mainnet), but the cap is the
 * guardrail the agent's own system prompt promises users, and the autonomy
 * loops (chat swaps, rebalance sweep, intent sweep) all route through it —
 * a rail that only binds in prod is a rail that never gets exercised.
 * USD equivalents come from live price feeds,
 * so the semantics hold; only the tokens are play money.
 *
 * Set SPENDING_CAP_ENFORCEMENT=off to restore the no-op explicitly (e.g.
 * for a high-volume demo). Read at import time, intentionally — flipping
 * requires a server restart, matching the rest of the chain-config rollover.
 */
const SPENDING_CAP_ENFORCED = process.env.SPENDING_CAP_ENFORCEMENT !== "off";

/** Whether the daily cap binds (callers can preflight-clamp instead of erroring). */
export function isSpendingCapEnforced(): boolean {
  return SPENDING_CAP_ENFORCED;
}

function utcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve the configured cap (USD) for a wallet address. Looks at the user's
 * primary wallet first, then agent wallets. Falls back to the default if no
 * record is found (treats it as an unknown wallet — we still cap it).
 */
export async function getDailyCap(address: string): Promise<number> {
  const lower = address.toLowerCase();
  const [user] = await db
    .select({ cap: userPreferences.dailyCapUsd })
    .from(users)
    .innerJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(eq(users.primaryAddress, lower))
    .limit(1);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty when no row matches.
  if (user) return Math.min(Number(user.cap), HARD_DAILY_CAP_USD);

  const [agent] = await db
    .select({ cap: agentWallets.dailyCapUsd })
    .from(agentWallets)
    .where(eq(agentWallets.address, lower))
    .limit(1);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty when no row matches.
  if (agent) return Math.min(Number(agent.cap), HARD_DAILY_CAP_USD);

  return DEFAULT_DAILY_CAP_USD;
}

/** Return today's accumulated spend (USD) for a wallet. */
export async function getDailySpend(
  address: string,
  spendDate: string = utcDate(),
): Promise<number> {
  const lower = address.toLowerCase();
  const [row] = await db
    .select({ spent: dailyWalletSpend.spentUsd })
    .from(dailyWalletSpend)
    .where(
      and(eq(dailyWalletSpend.walletAddress, lower), eq(dailyWalletSpend.spendDate, spendDate)),
    )
    .limit(1);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- drizzle types the row as defined, but the array is empty when no row matches.
  return row ? Number(row.spent) : 0;
}

/**
 * Sibling agent wallets for cross-chain cap sharing: if `address` is one
 * of a user's per-chain agent wallets, return ALL of that user's agent
 * wallet addresses so today's spend aggregates across chains — otherwise
 * two per-chain wallets would silently double the daily cap.
 */
async function capAddressGroup(lower: string): Promise<string[]> {
  const owner = (
    await db
      .select({ userId: agentWallets.userId })
      .from(agentWallets)
      .where(eq(agentWallets.address, lower))
      .limit(1)
  ).at(0);
  if (!owner) return [lower];
  const rows = await db
    .select({ address: agentWallets.address })
    .from(agentWallets)
    .where(eq(agentWallets.userId, owner.userId));
  const addrs = new Set(rows.map((r) => r.address.toLowerCase()));
  addrs.add(lower);
  return [...addrs];
}

/**
 * P1-001 — assert that `usdAmount` would not push the wallet over its
 * configured cap or the hard absolute ceiling. Read-only; does NOT increment
 * the ledger. Call `recordSpending` after the on-chain receipt confirms.
 *
 * For agent wallets the spend aggregates across every chain's wallet of
 * the same user — one shared daily cap, not one per chain.
 *
 * Enforced on every network unless SPENDING_CAP_ENFORCEMENT=off.
 */
export async function checkSpendingCap(address: string, usdAmount: number): Promise<void> {
  if (!SPENDING_CAP_ENFORCED) {
    logger.debug({ address, usdAmount }, "spending cap skipped (SPENDING_CAP_ENFORCEMENT=off)");
    return;
  }
  if (usdAmount < 0) throw new Error("checkSpendingCap: usdAmount must be non-negative");
  if (usdAmount > HARD_DAILY_CAP_USD) {
    throw new SafetyError(
      "spending_cap_hard_ceiling",
      `Single transaction $${String(usdAmount)} exceeds the absolute ceiling of $${String(HARD_DAILY_CAP_USD)}.`,
      { usdAmount, hardCeiling: HARD_DAILY_CAP_USD },
    );
  }
  const group = await capAddressGroup(address.toLowerCase());
  const [cap, ...spends] = await Promise.all([
    getDailyCap(address),
    ...group.map((a) => getDailySpend(a)),
  ]);
  const spent = spends.reduce((s, v) => s + v, 0);
  if (spent + usdAmount > cap) {
    throw new SafetyError(
      "spending_cap_exceeded",
      `Daily cap $${String(cap)} would be exceeded ($${String(spent)} already spent today, +$${String(usdAmount)}).`,
      { cap, spent, usdAmount },
    );
  }
}

/**
 * Increment today's ledger entry. Idempotent on (wallet, date) via UPSERT.
 * Caller should pass the actual settled USD value of the transaction.
 */
export async function recordSpending(address: string, usdAmount: number): Promise<void> {
  if (usdAmount < 0) throw new Error("recordSpending: usdAmount must be non-negative");
  const lower = address.toLowerCase();
  const today = utcDate();
  await db
    .insert(dailyWalletSpend)
    .values({ walletAddress: lower, spendDate: today, spentUsd: String(usdAmount), txCount: 1 })
    .onConflictDoUpdate({
      target: [dailyWalletSpend.walletAddress, dailyWalletSpend.spendDate],
      set: {
        spentUsd: sql`${dailyWalletSpend.spentUsd} + ${usdAmount}`,
        txCount: sql`${dailyWalletSpend.txCount} + 1`,
        updatedAt: sql`now()`,
      },
    });
}
