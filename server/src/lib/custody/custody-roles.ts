/**
 * Task 073 / IC-002 — the institutional tier's roles, the permission
 * matrix and the two dual-control rules. Pure: every route and gate asks
 * this module, none carries its own table.
 *
 * Roles: owner (everything, including the limits and the owner role),
 * admin (people, destinations, reports — not the limits), trader (trades
 * from the institution's wallets and asks for withdrawals), approver (the
 * second pair of eyes on withdrawals and destinations), viewer (reports).
 */

export const INSTITUTION_ROLES = ["owner", "admin", "trader", "approver", "viewer"] as const;
export type InstitutionRole = (typeof INSTITUTION_ROLES)[number];

export const CUSTODY_PERMISSIONS = [
  "view_reports",
  "trade",
  "request_withdrawal",
  "approve_withdrawal",
  "manage_members",
  "manage_destinations",
  "verify_destination",
  "manage_limits",
] as const;
export type CustodyPermission = (typeof CUSTODY_PERMISSIONS)[number];

const MATRIX: Record<InstitutionRole, readonly CustodyPermission[]> = {
  owner: CUSTODY_PERMISSIONS,
  admin: [
    "view_reports",
    "trade",
    "request_withdrawal",
    "approve_withdrawal",
    "manage_members",
    "manage_destinations",
    "verify_destination",
  ],
  trader: ["view_reports", "trade", "request_withdrawal"],
  approver: ["view_reports", "approve_withdrawal", "verify_destination"],
  viewer: ["view_reports"],
};

export function isInstitutionRole(v: unknown): v is InstitutionRole {
  return typeof v === "string" && (INSTITUTION_ROLES as readonly string[]).includes(v);
}

export function permissionsOf(role: InstitutionRole): CustodyPermission[] {
  return [...MATRIX[role]];
}

export function can(role: InstitutionRole, permission: CustodyPermission): boolean {
  return MATRIX[role].includes(permission);
}

/** Only an owner may hand out (or take away) the owner role. */
export function canAssignRole(actor: InstitutionRole, target: InstitutionRole): boolean {
  if (!can(actor, "manage_members")) return false;
  return target !== "owner" || actor === "owner";
}

export interface MemberActor {
  userId: string;
  role: InstitutionRole;
  /** active | removed */
  status: string;
}

export type DualControlReason = "member_inactive" | "forbidden" | "self_approval";
export type DualControlVerdict = { ok: true } | { ok: false; reason: DualControlReason };

function secondPerson(
  actor: MemberActor,
  permission: CustodyPermission,
  initiator: string,
): DualControlVerdict {
  if (actor.status !== "active") return { ok: false, reason: "member_inactive" };
  if (!can(actor.role, permission)) return { ok: false, reason: "forbidden" };
  if (actor.userId === initiator) return { ok: false, reason: "self_approval" };
  return { ok: true };
}

/** A withdrawal is approved by someone other than the person who asked. */
export function canApproveWithdrawal(
  approver: MemberActor,
  request: { requestedBy: string },
): DualControlVerdict {
  return secondPerson(approver, "approve_withdrawal", request.requestedBy);
}

/** A destination is verified by someone other than the person who added it. */
export function canVerifyDestination(
  verifier: MemberActor,
  destination: { addedBy: string },
): DualControlVerdict {
  return secondPerson(verifier, "verify_destination", destination.addedBy);
}
