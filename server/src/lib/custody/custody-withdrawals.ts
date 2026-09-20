import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../../db/client.ts";
import {
  custodyDestinations,
  custodyWithdrawals,
  type CustodyWithdrawal,
} from "../../db/schema/institutions.ts";
import { users } from "../../db/schema/users.ts";
import type { CustodyRefusalCode } from "./custody-policy.ts";
import { canApproveWithdrawal, type DualControlReason } from "./custody-roles.ts";
import { membershipForUser, memberView } from "./custody-store.ts";
import {
  executeWithdrawal,
  type AuditContext,
  type ExecuteResult,
} from "./custody-withdrawal-exec.ts";

/**
 * Task 074 / IC-001, IC-002 — the second pair of eyes. A pending request
 * is approved or rejected by a member with `approve_withdrawal` who is
 * not the requester; an expired request is stamped on sight; an approval
 * re-checks that the requester is still active and the destination still
 * verified before the send.
 */

export type DecideResult =
  | { kind: "not_member" }
  | { kind: "not_found" }
  | { kind: "not_pending"; status: string }
  | { kind: "expired" }
  | { kind: "forbidden"; reason: DualControlReason }
  | { kind: "requester_inactive" }
  | { kind: "refused"; code: CustodyRefusalCode; message: string }
  | { kind: "rejected"; withdrawal: CustodyWithdrawal }
  | ExecuteResult;

export async function decideWithdrawal(
  db: DB,
  input: {
    id: string;
    actorUserId: string;
    approve: boolean;
    reason?: string;
    audit: AuditContext;
  },
): Promise<DecideResult> {
  const m = await membershipForUser(db, input.actorUserId);
  if (!m) return { kind: "not_member" };
  const found = (
    await db
      .select({ w: custodyWithdrawals, d: custodyDestinations })
      .from(custodyWithdrawals)
      .innerJoin(custodyDestinations, eq(custodyDestinations.id, custodyWithdrawals.destinationId))
      .where(
        and(
          eq(custodyWithdrawals.id, input.id),
          eq(custodyWithdrawals.institutionId, m.institution.id),
        ),
      )
      .limit(1)
  ).at(0);
  if (!found) return { kind: "not_found" };
  if (found.w.status !== "pending") return { kind: "not_pending", status: found.w.status };
  const decide = async (status: string) =>
    (
      await db
        .update(custodyWithdrawals)
        .set({
          status,
          decidedBy: input.actorUserId,
          decidedAt: sql`now()`,
          reason: input.reason ?? null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(custodyWithdrawals.id, input.id), eq(custodyWithdrawals.status, "pending")))
        .returning()
    ).at(0);
  if (found.w.expiresAt.getTime() < Date.now()) {
    // Lapsed, not decided: no decider, no reason but the clock.
    await db
      .update(custodyWithdrawals)
      .set({ status: "expired", reason: "expired", updatedAt: sql`now()` })
      .where(and(eq(custodyWithdrawals.id, input.id), eq(custodyWithdrawals.status, "pending")));
    return { kind: "expired" };
  }
  const dual = canApproveWithdrawal(memberView(m.member), { requestedBy: found.w.requestedBy });
  if (!dual.ok) return { kind: "forbidden", reason: dual.reason };
  if (!input.approve) {
    const rejected = await decide("rejected");
    return rejected
      ? { kind: "rejected", withdrawal: rejected }
      : { kind: "not_pending", status: "decided" };
  }
  const requester = (
    await db.select().from(users).where(eq(users.id, found.w.requestedBy)).limit(1)
  ).at(0);
  const rm = requester ? await membershipForUser(db, requester.id) : null;
  if (!requester || rm?.member.status !== "active" || rm.institution.id !== m.institution.id) {
    return { kind: "requester_inactive" };
  }
  if (found.d.status !== "verified") {
    return {
      kind: "refused",
      code: "destination_unverified",
      message: "The destination is no longer verified.",
    };
  }
  const approved = await decide("approved");
  if (!approved) return { kind: "not_pending", status: "decided" };
  return executeWithdrawal(db, approved, found.d, requester.privyUserId, input.audit);
}
