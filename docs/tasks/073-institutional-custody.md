# Task 073 — Institutional Custody (Phase 18, IC-001 … IC-003)

> Numbering follows the owner's master list of 2026-09-16, refreshed
> 2026-09-19 (`docs/tasks/mantua-v1-task-list.md`), where Phase 18 is the
> institutional tier, 🟢 P2 and not a launch dependency. Phase 17 (Circle
> Agent Marketplace) is deliberately not started, at the owner's direction.

**Branch:** `claude/agent-extended-social-reputation-dzi0fj` (restarted from `main` at `54b8a2b`)
**Prompt history:** `docs/promptHistory/2026-09-19-institutional-custody.md`
**Decision:** D-120 (`docs/decisions/v2-open-decisions.md`) — an institution is a segregated Circle wallet set.

## Description

An institution (a fund, a syndicate, a trading desk) needs what a retail
user does not: its assets kept apart from everyone else's, no single
person able to move them out alone, only pre-approved places they can go,
a statement it can hand to its auditor, and a check that the custodian's
number matches the chain. Everything on Mantua that moves money already
runs through one of three choke points — the spending cap
(`checkSpendingCap`, C-019), the agent send path (`sendFromAgentWallet`)
and the Circle wallet provisioner (`getOrCreateAgentWallet`). Phase 18
adds the institutional rules at exactly those points and nowhere else.

One rule carries the phase (D-120): **an institution is a segregated
Circle wallet set.** Circle Developer-Controlled Wallets group wallets in
wallet sets under the operator's entity secret; the retail agent wallets
live in `CIRCLE_WALLET_SET_ID`. Each institution gets its own wallet set,
created through the same SDK, and every member's agent wallet is created
in it — so the institution's assets are never in a wallet that shares a
set with a retail user, Circle's per-set controls (Gas Station policy,
transaction screening in the Console) apply to the institution alone, and
the balance Circle reports for the set is the institution's and nothing
else's. The custodian the institution keeps its principal with (Anchorage,
BitGo, Coinbase Prime, Fireblocks, Copper, …) is recorded on the account
and its deposit addresses are the only places funds may leave to.

The phase, by row:

1. **Segregated custody (IC-001).** `institutions` with a Circle wallet
   set of its own (`provisionInstitutionWalletSet` → `createWalletSet`),
   `agent_wallets.wallet_set_id` recorded at creation, members' wallets
   provisioned into the institution's set, an existing retail wallet
   moved into it only when empty (`segregateAgentWallet`). Custody
   destinations — the custodian's addresses — added by an admin and
   verified by a different person before use. Withdrawals from an
   institutional wallet go only to a verified destination, through a
   request that a second member approves at or above the institution's
   threshold; the agent's own send path refuses any other route.
   Reconciliation: for every member wallet, the balance Circle reports
   against the chain's `balanceOf`, flagged when they disagree.
2. **Account tier (IC-002).** Roles — owner, admin, trader, approver,
   viewer — with a permission matrix in code; dual control (the requester
   never approves their own withdrawal, the adder never verifies their own
   destination); institution-level per-trade and aggregate daily caps on
   top of each wallet's cap, enforced in `checkSpendingCap` for every
   money path (trades, combos, hedges, sends); statements over a period
   (fills, sends, executions, withdrawals, spend) as JSON or CSV; the
   audit trail export; an Institution section on the profile.
3. **Architecture (IC-003).** `docs/architecture.md` gains the
   institutional custody section: who holds which key, what segregation
   means in Circle terms, the three choke points, the dual-control rules,
   what the tier does not do.

## Success criteria

- Provisioning an institution creates (or records) a dedicated Circle
  wallet set; a member's agent wallet is created in that set and carries
  its `wallet_set_id`; a retail wallet outside the set is moved only when
  its USDC balance is zero, else refused with the balance.
- `checkSpendingCap` refuses a spend from an institutional wallet when the
  institution is not active, the member is not active or cannot trade,
  the wallet is not in the institution's set, the amount exceeds the
  per-trade cap, or the institution's aggregate spend today would exceed
  its daily cap — each a `SafetyError` with a custody code. Retail
  wallets are untouched.
- `sendFromAgentWallet` from an institutional wallet requires an approved
  custody withdrawal for that wallet, destination and amount; the agent's
  chat send and any other caller without one is refused.
- A withdrawal request below the threshold executes at once (through the
  same send path); at or above it waits for a second member with
  approval rights, who is not the requester; rejection and expiry are
  recorded; every decision is audited.
- Statements and the audit export cover every member wallet for the
  period, in JSON and CSV, and only members with `view_reports` can read
  them; member management, destinations and limits are role-gated.
- Reconciliation reports per wallet the Circle balance, the chain
  balance and the status (`matched` / `drift` / `unavailable`).
- Operator routes (`/api/ops/institutions*`) are guarded by
  `requireOpsAuth` (`MANTUA_OPS_KEY`), 503 when unset; the route-guard
  audit passes.
- Every new pure module has tests written first; files stay ≤ 150 lines;
  lint, typecheck, server and client suites, both e2e suites green.

## Failure conditions

- An institutional wallet created in the retail wallet set, or a member's
  spend allowed from a wallet outside the institution's set.
- A withdrawal that leaves an institutional wallet to an unverified
  address, or approved by its own requester.
- The aggregate cap counted per wallet rather than across the
  institution, or a viewer able to spend.
- Reports readable by a non-member or a member without the permission.
- A new dependency, a hardcoded secret, or an unguarded mutating route.

## Edge cases

- Circle unavailable: institution rows can be created (status `pending`);
  provisioning the wallet set and reconciliation return 503; everything
  that reads the database still works.
- A user who is already a member of another institution — refused (one
  institution per user).
- A member removed while holding a pending withdrawal request — the
  request cannot be approved (the requester must be active).
- Threshold `0` means every withdrawal needs a second approver.
- A destination revoked after a request was made against it — the
  approval fails the gate (destination must be verified at execution).
- Chain read failure during reconciliation — `unavailable`, never
  `matched`.
- CSV cells containing commas, quotes or newlines are quoted.

## Implementation checklist

- [x] Task document, prompt history
- [x] Schema (`institutions`, `institution_members`, `custody_destinations`, `custody_withdrawals`, `agent_wallets.wallet_set_id`), migration 0025, `MANTUA_OPS_KEY`, `requireOpsAuth`, custody `SafetyError` codes
- [x] Pure modules with tests: `custody-roles`, `custody-policy`, `custody-statement`, `custody-reconcile`
- [x] IO: `custody-store`, `custody-wallet-set` (provision, segregate), `custody-gate` in `checkSpendingCap`, send gate in `sendFromAgentWallet`, `custody-withdrawals`, `custody-reports`, `custody-reconcile-run`
- [x] Routes: ops institutions; institution (me, members, destinations, wallet segregation); withdrawals; reports; app registration; route tests
- [x] Client: institution feature on the profile and the phone's Account tab; pure core tests
- [x] Docs: architecture (IC-003), D-120, roadmap, master list, `.env.example`
- [x] Review round, verification, commit, PR, merge

## Notes

- **No custodian integration.** The qualified custodian is recorded on
  the account and its addresses form the allowlist; Mantua holds no
  custodian credential. D-120 records why.
- **The segregation move replaces a wallet only when it holds nothing** —
  no app token, no open market position — and it changes the address:
  history keyed on the old address (fills, transactions, the spend
  ledger) stays with that address, and the old Circle wallet id goes to
  the audit log through the result. Funds are never moved by this path.
- **Review round.** The repository's code-review pass (`code-review main
high`; Gemini and o3 are not reachable from this session) returned ten
  findings; all ten are addressed in this change:
  1. The move checked only USDC → every app token and open positions; the
     old wallet id recorded.
  2. A receipt timeout left a withdrawal `executing` forever → the send's
     execution payload carries the withdrawal id and the webhook
     finalizer stamps `executed` / `failed` (`custody_withdrawal` effect).
  3. The members view selected the whole `users` table → filtered by id.
  4. A request could pass the institution's gate and fail the wallet's own
     cap at execution → the wallet cap is checked at request time.
  5. A removed member was locked out of every wallet for good → a removed
     member's wallet outside the institution's set is retail again (one in
     the set stays locked); a removed member can be re-homed.
  6. The spend ledger dropped the period's last day → inclusive of the day
     `to` falls in.
  7. An unprovisioned institution surfaced as 500 on wallet creation →
     409 `CUSTODY_UNPROVISIONED` on both provisioning routes.
  8. Every add-destination error read as a duplicate → an explicit
     duplicate check; other errors surface.
  9. An expired request was stamped as the approver's decision → lapsed
     rows carry no decider.
  10. The ops-guard test imported the environment → the guard is a pure
      factory (`ops-auth-core.ts`) tested without it.
