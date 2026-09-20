import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  can,
  canApproveWithdrawal,
  canAssignRole,
  canVerifyDestination,
  INSTITUTION_ROLES,
  permissionsOf,
} from "./custody-roles.ts";

/** Task 074 / IC-002 — the permission matrix and the dual-control rules. */

const member = (userId: string, role: (typeof INSTITUTION_ROLES)[number], status = "active") =>
  ({ userId, role, status }) as const;

void describe("custody roles", () => {
  void it("owner holds every permission; viewer only reads", () => {
    assert.ok(can("owner", "manage_limits"));
    assert.ok(can("owner", "approve_withdrawal"));
    assert.deepEqual(permissionsOf("viewer"), ["view_reports"]);
    assert.equal(can("viewer", "trade"), false);
  });
  void it("admin manages people and destinations but not the limits", () => {
    assert.ok(can("admin", "manage_members"));
    assert.ok(can("admin", "verify_destination"));
    assert.equal(can("admin", "manage_limits"), false);
  });
  void it("trader trades and requests; approver approves and verifies", () => {
    assert.ok(can("trader", "trade"));
    assert.ok(can("trader", "request_withdrawal"));
    assert.equal(can("trader", "approve_withdrawal"), false);
    assert.ok(can("approver", "approve_withdrawal"));
    assert.equal(can("approver", "trade"), false);
  });
  void it("only an owner assigns or removes the owner role", () => {
    assert.ok(canAssignRole("owner", "owner"));
    assert.equal(canAssignRole("admin", "owner"), false);
    assert.ok(canAssignRole("admin", "trader"));
    assert.equal(canAssignRole("trader", "viewer"), false);
  });
});

void describe("dual control", () => {
  void it("the requester never approves their own withdrawal", () => {
    const r = canApproveWithdrawal(member("u1", "approver"), { requestedBy: "u1" });
    assert.deepEqual(r, { ok: false, reason: "self_approval" });
    assert.deepEqual(canApproveWithdrawal(member("u2", "approver"), { requestedBy: "u1" }), {
      ok: true,
    });
  });
  void it("approval needs the permission and an active member", () => {
    assert.deepEqual(canApproveWithdrawal(member("u2", "trader"), { requestedBy: "u1" }), {
      ok: false,
      reason: "forbidden",
    });
    assert.deepEqual(
      canApproveWithdrawal(member("u2", "owner", "removed"), { requestedBy: "u1" }),
      { ok: false, reason: "member_inactive" },
    );
  });
  void it("the adder never verifies their own destination", () => {
    assert.deepEqual(canVerifyDestination(member("u1", "admin"), { addedBy: "u1" }), {
      ok: false,
      reason: "self_approval",
    });
    assert.deepEqual(canVerifyDestination(member("u3", "approver"), { addedBy: "u1" }), {
      ok: true,
    });
  });
});
