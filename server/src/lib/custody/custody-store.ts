import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import { agentWallets, type AgentWallet } from "../../db/schema/agent.ts";
import {
  institutionMembers,
  institutions,
  type Institution,
  type InstitutionMember,
} from "../../db/schema/institutions.ts";
import { dailyWalletSpend } from "../../db/schema/safety.ts";
import type { InstitutionLimits, MemberView } from "./custody-policy.ts";
import { isInstitutionRole, type InstitutionRole } from "./custody-roles.ts";

/**
 * Task 073 — the institutional tier's reads: who belongs where, which
 * wallets are the institution's, and how much they spent today. Every
 * gate and route starts here so the joins live once.
 */

export interface Membership {
  institution: Institution;
  member: InstitutionMember;
}

export function limitsOf(i: Institution): InstitutionLimits {
  return {
    status: i.status,
    circleWalletSetId: i.circleWalletSetId,
    perTradeCapUsd: Number(i.perTradeCapUsd),
    dailyCapUsd: Number(i.dailyCapUsd),
    approvalThresholdUsd: Number(i.approvalThresholdUsd),
  };
}

/** An unknown stored role is read as the least privileged one. */
export function roleOf(m: InstitutionMember): InstitutionRole {
  return isInstitutionRole(m.role) ? m.role : "viewer";
}

export function memberView(m: InstitutionMember): MemberView {
  return { userId: m.userId, role: roleOf(m), status: m.status };
}

/** The user's membership (active or removed), or null for a retail user. */
export async function membershipForUser(db: DB, userId: string): Promise<Membership | null> {
  const rows = await db
    .select({ institution: institutions, member: institutionMembers })
    .from(institutionMembers)
    .innerJoin(institutions, eq(institutions.id, institutionMembers.institutionId))
    .where(eq(institutionMembers.userId, userId))
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * The membership behind an agent wallet address, or null for a retail
 * wallet. A removed member's wallet that is still in the institution's
 * set stays the institution's (its balance is theirs, and the gates keep
 * it locked); a removed member's wallet anywhere else is retail again.
 */
export async function membershipForWallet(
  db: DB,
  address: string,
): Promise<(Membership & { wallet: AgentWallet }) | null> {
  const rows = await db
    .select({ institution: institutions, member: institutionMembers, wallet: agentWallets })
    .from(agentWallets)
    .innerJoin(institutionMembers, eq(institutionMembers.userId, agentWallets.userId))
    .innerJoin(institutions, eq(institutions.id, institutionMembers.institutionId))
    .where(eq(agentWallets.address, address.toLowerCase()))
    .limit(1);
  const row = rows.at(0);
  if (!row) return null;
  const inSet =
    row.institution.circleWalletSetId !== null &&
    row.wallet.walletSetId === row.institution.circleWalletSetId;
  return row.member.status === "active" || inSet ? row : null;
}

/** Every agent wallet of every member, past and present (reports need history). */
export async function institutionWallets(db: DB, institutionId: string): Promise<AgentWallet[]> {
  return db
    .select({ wallet: agentWallets })
    .from(agentWallets)
    .innerJoin(institutionMembers, eq(institutionMembers.userId, agentWallets.userId))
    .where(eq(institutionMembers.institutionId, institutionId))
    .then((rows) => rows.map((r) => r.wallet));
}

/** Today's spend across the institution's wallets (USD), for the aggregate cap. */
export async function institutionSpentToday(
  db: DB,
  institutionId: string,
  spendDate: string = new Date().toISOString().slice(0, 10),
): Promise<number> {
  const wallets = (await institutionWallets(db, institutionId)).map((w) => w.address);
  if (wallets.length === 0) return 0;
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${dailyWalletSpend.spentUsd}), 0)` })
    .from(dailyWalletSpend)
    .where(
      and(
        inArray(dailyWalletSpend.walletAddress, wallets),
        eq(dailyWalletSpend.spendDate, spendDate),
      ),
    );
  return Number(rows.at(0)?.total ?? 0);
}

export async function institutionById(db: DB, id: string): Promise<Institution | null> {
  const rows = await db.select().from(institutions).where(eq(institutions.id, id)).limit(1);
  return rows.at(0) ?? null;
}

export async function membersOf(db: DB, institutionId: string): Promise<InstitutionMember[]> {
  return db
    .select()
    .from(institutionMembers)
    .where(eq(institutionMembers.institutionId, institutionId));
}
