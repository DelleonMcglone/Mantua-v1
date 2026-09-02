import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { agentWallets, type AgentWallet } from "../db/schema/agent.ts";
import { users } from "../db/schema/users.ts";
import { deriveAgentAccountName } from "./agent-wallet-name.ts";
import { getAgentWalletSetId, getCircleClient } from "./circle/client.ts";
import { recordFirstSeen } from "./wallet-age.ts";

export { deriveAgentAccountName };

import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";

/** Circle blockchain ids per supported chain. */
export type CircleBlockchain = "BASE";
const CIRCLE_BLOCKCHAIN: Record<SupportedChainId, CircleBlockchain> = {
  [BASE_CHAIN_ID]: "BASE",
};

export function circleBlockchainFor(chainId: SupportedChainId): CircleBlockchain {
  return CIRCLE_BLOCKCHAIN[chainId];
}

export class UserNotFoundError extends Error {
  constructor(privyUserId: string) {
    super(
      `No user record found for Privy user ${privyUserId}. The user must connect their primary wallet (recordFirstSeen) before an agent wallet can be provisioned.`,
    );
    this.name = "UserNotFoundError";
  }
}

export class AgentWalletNotFoundError extends Error {
  constructor(privyUserId: string) {
    super(
      `No agent wallet provisioned for Privy user ${privyUserId}. Call POST /api/agent/wallet first.`,
    );
    this.name = "AgentWalletNotFoundError";
  }
}

/**
 * P6-003 — provision (or return) the user's single agent wallet.
 *
 * Order of operations:
 *   1. Resolve our internal user.id from privyUserId. If no user row exists
 *      yet, record first-seen with `primaryAddress` (the authenticated
 *      wallet) so provisioning self-heals on a user's first agent action.
 *      Errors only if we also have no wallet address to record.
 *   2. If an `agent_wallets` row already exists for this user, return it
 *      (cheap path; Circle is not contacted).
 *   3. Otherwise create a Circle Developer-Controlled Wallet on Base
 *      (SCA account) in the agent wallet set, and persist it with
 *      `onConflictDoNothing` on the unique `user_id` index. The onConflict
 *      path covers a concurrent-request race where two requests both passed
 *      step 2 simultaneously (the loser's freshly-created Circle wallet is
 *      simply left unused).
 *   4. If the insert returned nothing (race lost), re-read.
 *
 * One wallet per user — enforced by the unique `user_id` constraint.
 */
export async function getOrCreateAgentWallet(
  privyUserId: string,
  primaryAddress?: string,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<AgentWallet> {
  const blockchain = circleBlockchainFor(chainId);
  // Indexing into the array (rather than destructuring) gives TS the
  // correct `T | undefined` narrowing — drizzle's destructured-element
  // type is otherwise too loose and the `if (!x)` guard becomes a
  // no-op under @typescript-eslint/no-unnecessary-condition.
  const lookupUser = async () =>
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.privyUserId, privyUserId))
        .limit(1)
    ).at(0);

  let user = await lookupUser();
  if (!user) {
    // No user row yet — record first-seen so provisioning works on the
    // user's first agent action (the connect-time hook was never wired).
    // Without a wallet address there's nothing to record, so surface the
    // original "connect your primary wallet" error.
    if (!primaryAddress) throw new UserNotFoundError(privyUserId);
    await recordFirstSeen(privyUserId, primaryAddress);
    user = await lookupUser();
    if (!user) throw new UserNotFoundError(privyUserId);
  }

  const existingRows = await db
    .select()
    .from(agentWallets)
    .where(and(eq(agentWallets.userId, user.id), eq(agentWallets.blockchain, blockchain)))
    .limit(1);
  const existing = existingRows.at(0);
  if (existing) return existing;

  const walletSetId = await getAgentWalletSetId();
  const created = await (
    await getCircleClient()
  ).createWallets({
    blockchains: [blockchain],
    count: 1,
    walletSetId,
    accountType: "SCA",
  });
  const wallet = created.data?.wallets.at(0);
  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle createWallets returned no wallet");
  }

  const insertRows = await db
    .insert(agentWallets)
    .values({
      userId: user.id,
      blockchain,
      circleWalletId: wallet.id,
      address: wallet.address.toLowerCase(),
    })
    .onConflictDoNothing({ target: [agentWallets.userId, agentWallets.blockchain] })
    .returning();
  const row = insertRows.at(0);
  if (row) return row;

  const retryRows = await db
    .select()
    .from(agentWallets)
    .where(and(eq(agentWallets.userId, user.id), eq(agentWallets.blockchain, blockchain)))
    .limit(1);
  const retry = retryRows.at(0);
  if (!retry) {
    throw new Error("agent-wallet provision: row vanished after insert race");
  }
  return retry;
}

export async function getAgentWallet(
  privyUserId: string,
  chainId: SupportedChainId = BASE_CHAIN_ID,
): Promise<AgentWallet | null> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const user = userRows.at(0);
  if (!user) return null;
  const rows = await db
    .select()
    .from(agentWallets)
    .where(
      and(
        eq(agentWallets.userId, user.id),
        eq(agentWallets.blockchain, circleBlockchainFor(chainId)),
      ),
    )
    .limit(1);
  return rows.at(0) ?? null;
}

/** Every provisioned agent wallet for the user, across chains. */
export async function getAgentWallets(privyUserId: string): Promise<AgentWallet[]> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const user = userRows.at(0);
  if (!user) return [];
  return db.select().from(agentWallets).where(eq(agentWallets.userId, user.id));
}

/**
 * P6-011 — set the agent wallet's daily USD spending cap.
 *
 * The spending-cap infrastructure in `server/src/lib/spending-cap.ts`
 * already keys on wallet address and falls through to `agent_wallets`
 * when the user-wallet lookup misses (see `getDailyCap`). What was
 * missing was a way to *configure* the cap per agent — agent wallets
 * were created with the schema default ($100) and there was no path to
 * change it. P6-011 adds that path.
 *
 * Cap range is enforced in the route layer (zod schema in
 * `server/src/routes/agent-wallets.ts`): non-negative number,
 * ≤ HARD_DAILY_CAP_USD ($50k). Values are stored as strings in the
 * `numeric(20,2)` column. Throws `UserNotFoundError` if the user has
 * no record yet, `AgentWalletNotFoundError` if no agent wallet is
 * provisioned for them.
 */
export async function updateAgentWalletCap(
  privyUserId: string,
  dailyCapUsd: number,
): Promise<AgentWallet> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  const user = userRows.at(0);
  if (!user) throw new UserNotFoundError(privyUserId);

  // The cap is the user's cap — apply to every chain's wallet row.
  const updateRows = await db
    .update(agentWallets)
    .set({ dailyCapUsd: dailyCapUsd.toFixed(2), updatedAt: sql`now()` })
    .where(eq(agentWallets.userId, user.id))
    .returning();
  const wallet = updateRows.at(0);
  if (!wallet) throw new AgentWalletNotFoundError(privyUserId);
  return wallet;
}
