import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { env } from "../env.ts";
import { agentWallets, type AgentWallet } from "../db/schema/agent.ts";
import { users } from "../db/schema/users.ts";
import { deriveAgentAccountName } from "./agent-wallet-name.ts";
import { getAgentWalletSetId, getCircleClient } from "./circle/client.ts";
import { recordFirstSeen } from "./wallet-age.ts";

export { deriveAgentAccountName };

import { BASE_CHAIN_ID, type SupportedChainId } from "./chains.ts";
import { HARD_DAILY_CAP_USD } from "./constants.ts";

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

export class InvalidDailyCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDailyCapError";
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
  const client = await getCircleClient();
  // Pin the SCA version (CIRCLE_SCA_CORE) so a wallet created on any chain
  // under this wallet set derives the same address as the existing ones —
  // the property gateway spends rely on (they default the destination
  // recipient to the agent's own address). Circle's platform default
  // changes on 2026-09-14; the installed SDK types predate the field, but
  // the client spreads every input into the request body, so it reaches
  // the API. Runbook §11.
  const input: Parameters<typeof client.createWallets>[0] & {
    scaConfiguration: { scaCore: string };
  } = {
    blockchains: [blockchain],
    count: 1,
    walletSetId,
    accountType: "SCA",
    scaConfiguration: { scaCore: env.CIRCLE_SCA_CORE },
  };
  const created = await client.createWallets(input);
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
 * C-010 — validate a daily-cap value at the LIBRARY layer, so every caller
 * (HTTP route, agent tool, future scripts) hits the same bound. The HTTP
 * route's zod schema already bounds the value; this is defense in depth for
 * paths (like the agent's own `manage_wallet` tool) that reach
 * `updateAgentWalletCap` without passing through that schema.
 *
 * Rules: finite number, strictly positive, at most HARD_DAILY_CAP_USD.
 * Throws `InvalidDailyCapError` with a message safe to surface to the model
 * or the user.
 */
export function assertValidDailyCap(dailyCapUsd: number): void {
  if (!Number.isFinite(dailyCapUsd)) {
    throw new InvalidDailyCapError("dailyCapUsd must be a finite number.");
  }
  if (dailyCapUsd <= 0) {
    throw new InvalidDailyCapError("dailyCapUsd must be greater than zero.");
  }
  if (dailyCapUsd > HARD_DAILY_CAP_USD) {
    throw new InvalidDailyCapError(
      `dailyCapUsd must not exceed the absolute ceiling of $${String(HARD_DAILY_CAP_USD)}.`,
    );
  }
}

/**
 * C-010 — code-level attestation for agent-initiated cap RAISES, the same
 * mechanism as the swap tool's `force` override (`lib/force-attestation.ts`):
 * the model may only widen its own spending headroom when the user's CURRENT
 * message itself states the new amount in a cap/limit context. Checked
 * against the raw message text server-side — never model-decided.
 *
 * Deliberately conservative, like `messageAuthorizesForce`: generic consent
 * ("yes", "go ahead") does NOT attest a raise, and neither does a message
 * that mentions the amount without talking about the cap ("send 500 USDC").
 * The message must (a) mention the cap/limit and (b) contain the exact new
 * amount ("raise my daily cap to $500", "set my spending limit to 5k").
 * A false negative costs one clarifying round-trip; a false positive lets
 * the agent raise its own blast radius.
 */
const CAP_CONTEXT_RE = /\b(cap|limit)\b/i;
/** Dollar amounts in free text: "$500", "5,000", "500.00", "5k". */
const AMOUNT_RE = /\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kK])?\b/g;

function messageUsdAmounts(message: string): number[] {
  const amounts: number[] = [];
  for (const m of message.matchAll(AMOUNT_RE)) {
    // Group 1 always participates in a match (it is the whole alternation).
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    amounts.push(m[2] ? value * 1000 : value);
  }
  return amounts;
}

/** True when the user's own message attests the new (raised) cap amount. */
export function messageAttestsCapRaise(message: string, newCapUsd: number): boolean {
  if (!Number.isFinite(newCapUsd) || newCapUsd <= 0) return false;
  if (!CAP_CONTEXT_RE.test(message)) return false;
  return messageUsdAmounts(message).some((v) => Math.abs(v - newCapUsd) < 0.005);
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
 * Cap range is enforced HERE (`assertValidDailyCap` — C-010 defense in
 * depth: finite, > 0, ≤ HARD_DAILY_CAP_USD $50k) as well as in the HTTP
 * route layer (zod schema in `server/src/routes/agent-wallets.ts`), so a
 * caller that bypasses the route — the agent's own `manage_wallet` tool —
 * can never write an unbounded cap. Values are stored as strings in the
 * `numeric(20,2)` column. Throws `InvalidDailyCapError` on an out-of-range
 * value, `UserNotFoundError` if the user has no record yet,
 * `AgentWalletNotFoundError` if no agent wallet is provisioned for them.
 */
export async function updateAgentWalletCap(
  privyUserId: string,
  dailyCapUsd: number,
): Promise<AgentWallet> {
  assertValidDailyCap(dailyCapUsd);
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
