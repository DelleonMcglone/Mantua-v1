# Prompt History — Institutional Custody (Phase 18, task 073)

**Date:** 2026-09-19
**Branch:** `claude/agent-extended-social-reputation-dzi0fj` (restarted from `main` at `54b8a2b`)
**Task:** 073 — Phase 18 IC-001 … IC-003, on the owner's master list refreshed 2026-09-19.

## Original prompt (owner)

> 🏦 PHASE 18: Institutional Custody 🟢
>
> IC-001 Circle + institutional custody ecosystem integration: segregated,
> institutional-grade asset protection
> IC-002 Institutional account tier: custody, reporting, permissions
> IC-003 Document institutional custody architecture in docs/architecture.md

(Given after the owner's "do not do phase 17" — Phase 17 stays untouched.)

## Refined prompt

Build Phase 18 as task 073 on the existing Circle custody posture (C-009:
Privy for users, Circle Developer-Controlled Wallets for agents, the
entity secret only in the operator's secrets manager) with these
resolutions of the open questions:

1. **What "segregated" means.** An institution is a Circle wallet set of
   its own, created through the installed SDK's `createWalletSet` and
   pinned on the institution row; every member's agent wallet is created
   in that set, never in the retail set. Circle's per-set controls (Gas
   Station policy, transaction screening) therefore scope to the
   institution. No new dependency, no custodian API integration: the
   qualified custodian the institution uses is recorded on the account and
   its deposit addresses are the withdrawal allowlist.
2. **Asset protection in code, at the choke points that already exist.**
   Institution-level rules run inside `checkSpendingCap` (every money
   path) and `sendFromAgentWallet` (the only agent send), plus the
   provisioner. Withdrawals go only to verified destinations, need a
   second approver at or above a threshold, and the requester never
   approves their own; destinations are verified by someone other than
   the adder. Institution-wide per-trade and aggregate daily caps sit on
   top of each wallet's cap.
3. **Tier.** Roles owner / admin / trader / approver / viewer with a
   permission matrix in code; one institution per user; operator creates
   institutions behind an ops key; admins manage members, destinations
   and (owner) limits.
4. **Reporting.** Period statements (fills, sends, executions,
   withdrawals, daily spend) and the audit trail, JSON or CSV, over every
   member wallet; reconciliation of the balance Circle reports against the
   chain's `balanceOf` per wallet.
5. **Deployment gating.** Circle absent → provisioning and reconciliation
   503; the tier's database side works regardless.

Success: the criteria in `docs/tasks/073-institutional-custody.md`. Files
≤ 150 lines, TDD on every pure module, no hardcoded secrets, every
mutating route guarded.

## Why the refined prompt is better

The original names an "ecosystem integration" without saying what would
be integrated; the refinement grounds it in the one segregation primitive
Circle actually exposes to this stack (wallet sets) and in the three
choke points the codebase already funnels money through, so the
protection is enforced rather than described. It also fixes the tier's
shape (roles, dual control, caps, reports) so each row has a testable
outcome.

## Process notes

- Task document written before code; checklist ticked as rows land.
- The o3 pre-review and Gemini code review were not reachable from this
  session; the repository's code-review pass stands in (recorded in the
  task document).
