import type { Request, Response } from "express";
import { db } from "../db/client.ts";
import {
  can,
  permissionsOf,
  type CustodyPermission,
  type InstitutionRole,
} from "../lib/custody/custody-roles.ts";
import { membershipForUser, roleOf, type Membership } from "../lib/custody/custody-store.ts";
import { resolveUserId } from "../lib/sports/strategy-store.ts";

/**
 * Task 073 — the member context every `/api/institution/*` handler starts
 * from: the caller's user id, their membership and role, and one place the
 * permission check answers 403. A retail user gets 404 `NOT_MEMBER`; a
 * removed member 403 `MEMBER_INACTIVE`.
 */

export interface MemberContext extends Membership {
  userId: string;
  role: InstitutionRole;
  permissions: CustodyPermission[];
}

export async function memberContext(req: Request, res: Response): Promise<MemberContext | null> {
  const userId = req.privyUserId ? await resolveUserId(db, req.privyUserId) : null;
  if (!userId) {
    res.status(401).json({ error: "No user record", code: "USER_REQUIRED" });
    return null;
  }
  const m = await membershipForUser(db, userId);
  if (!m) {
    res.status(404).json({ error: "You are not a member of an institution.", code: "NOT_MEMBER" });
    return null;
  }
  if (m.member.status !== "active") {
    res.status(403).json({ error: "Your membership is not active.", code: "MEMBER_INACTIVE" });
    return null;
  }
  const role = roleOf(m.member);
  return { ...m, userId, role, permissions: permissionsOf(role) };
}

/** True when the caller holds the permission; otherwise 403 is written. */
export function allow(ctx: MemberContext, permission: CustodyPermission, res: Response): boolean {
  if (can(ctx.role, permission)) return true;
  res.status(403).json({
    error: `Your role (${ctx.role}) cannot ${permission.replaceAll("_", " ")}.`,
    code: "FORBIDDEN",
    details: { permission },
  });
  return false;
}
