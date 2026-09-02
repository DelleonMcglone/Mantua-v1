# Sports Pivot — Decision Memo (DM-101 … DM-112)

**Task:** B0-001 in `docs/tasks/sports-pivot.md`.
**Convention:** every decision carries a status, the decision itself, the
reasoning, and what was rejected. `✅ CLOSED` is binding on downstream phases;
`⏸ BLOCKED` cannot be closed until the named input arrives.

**Status as of 2026-08-16: 8 closed, 3 open.**

| ID     | Decision                   | Status    | Outcome                                                                        |
| ------ | -------------------------- | --------- | ------------------------------------------------------------------------------ |
| DM-101 | Market mechanism           | ✅ CLOSED | Outcome-token AMM — YES/NO ERC-20 against USDC in v4 pools                     |
| DM-102 | Conditional token standard | ✅ CLOSED | Purpose-built binary ERC-20 pair per market                                    |
| DM-103 | Resolution authority       | ⏸ OPEN    | Needs owner sign-off — trust model with user-visible consequences              |
| DM-104 | Chain                      | ✅ CLOSED | Arc Testnet (5042002)                                                          |
| DM-105 | League coverage            | ✅ CLOSED | NFL and WNBA; other leagues show "Coming soon"                                 |
| DM-106 | Market types               | ✅ CLOSED | Moneyline at launch; totals deferred to W4 as P2                               |
| DM-107 | Settlement data source     | ✅ CLOSED | ESPN primary, second provider in W3 for disagreement detection                 |
| DM-108 | Jurisdictional posture     | ✅ CLOSED | Testnet, implied not marketed — no testnet notice in the UI                    |
| DM-110 | Dynamic Market Hook spec   | ⏸ BLOCKED | Spec not supplied; B2 (6 × P0) cannot start                                    |
| DM-111 | Agent wallet path          | ✅ CLOSED | Keep the existing Circle DCW path — Arc fully supported, no migration needed   |
| DM-112 | Routing split              | ✅ CLOSED | Market pools direct to PoolManager/PositionManager; Trading API for base pairs |

---

## DM-101 — Market mechanism ✅ CLOSED 2026-08-16

**Decision.** Outcome-token AMM: each market mints a YES/NO ERC-20 pair, and
the YES token trades against USDC in a Uniswap v4 pool.

**Reasoning.** The repo already runs v4 pools, hooks, position management, and
routing — an outcome-token AMM reuses all of it, where a central limit order
book would mean building matching, custody of resting orders, and a separate
settlement path from scratch inside a four-week window. It also makes the
Dynamic Market Hook meaningful: the hook only has a lifecycle to attach to
because pricing happens in a pool. Price maps directly to implied probability,
which is what the UI needs to display.

**Rejected.** CLOB (build cost, no hook surface); parimutuel pools (no
continuous price, so no in-play trading and nothing for an agent to hedge
against).

---

## DM-102 — Conditional token standard ✅ CLOSED 2026-08-16

**Decision.** A purpose-built binary ERC-20 pair per market, minted by
`MarketFactory`, USDC-collateralised 1:1.

**Reasoning.** Binary sports moneylines need exactly two outcomes, and plain
ERC-20s drop straight into v4 pools, wallets, and the existing balance and
portfolio code with no adapter layer. Gnosis Conditional Tokens (ERC-1155) is
the general answer, but its generality — nested conditions, partitions,
multi-outcome splits — is scope this build does not need, and ERC-1155 would
need shims everywhere the app currently assumes ERC-20.

**Rejected.** Gnosis CTF (complexity out of proportion to binary markets);
ERC-6909 (v4-native and cheaper, but less tooling and wallet support).

**Consequence.** Multi-outcome markets (three-way soccer results) do not fit a
binary pair and need a revisit before soccer moves from "Coming soon" to
covered.

---

## DM-103 — Resolution authority ⏸ OPEN

**Proposed default.** A Mantua-held resolver key with manual override,
disclosed in the UI.

**Why it is still open.** This is the trust model, not an implementation
detail: it decides who can declare an outcome, and therefore who can move user
funds by declaring the wrong one. The plan's own Risk 2 acknowledges v1 ships a
trusted resolver with no dispute window. That is a legitimate choice for a
testnet build, but it is the owner's to make, and it has consequences that
reach into the Terms of Use and the Market Integrity policy, both of which
currently say nothing about resolution.

**What closing it requires.** Confirm the signer arrangement (single key vs.
multisig from day one — B4-007 currently defers multisig to P2), and confirm
that the UI disclosure required by B4-006 is acceptable in place of a dispute
window.

---

## DM-104 — Chain ✅ CLOSED 2026-08-16

**Decision.** Arc Testnet, chain ID 5042002.

**Reasoning.** It is the current build target: hooks are deployed there,
`chains.ts` already carries the RPC fallback chain, and native-USDC gas removes
the second-token funding problem for every new user. Changing chains now would
invalidate the deployed Stable Protection and Dynamic Fee hooks and the
funding path in the docs.

**Consequence.** Everything downstream inherits Arc's 18-decimal native / 6-
decimal ERC-20 split. B1-006 requires outcome tokens to use the shared decimals
utility; this is the single most common integration bug on Arc.

---

## DM-105 — League coverage ✅ CLOSED 2026-08-16

**Decision.** NFL and WNBA are covered. NBA, MLB, NHL, and Soccer stay in the
nav carrying a "Soon" marker and a coming-soon market page.

**Reasoning.** Owner decision. Two leagues bound the B3 data work to a
manageable size while keeping the nav aspirational.

**Implementation.** `coverage: "launch" | "soon"` on each entry in
`client/src/features/markets/sports.ts`; the nav and market pages both derive
from it, so promoting a league is a one-word change.

**Consequence.** The plan assumed one league in W1 and a second in W3. Both are
named now, so B3-002 needs both adapters from the start. Their seasons barely
overlap, which makes live-polling easier to test one league at a time.

---

## DM-106 — Market types ✅ CLOSED 2026-08-16

**Decision.** Moneyline only at launch. Totals in W4 as P2. Spreads deferred
past Sept 16.

**Reasoning.** Moneyline is the only market type that is genuinely binary, so
it is the only one that fits the DM-102 token model without further design.
Totals and spreads need a line value per market and push handling, which is new
surface in B1, B3, and B4 alike.

---

## DM-107 — Settlement data source ✅ CLOSED 2026-08-16

**Decision.** ESPN primary via `site.api.espn.com`, with a second provider in
W3 for disagreement detection.

**Reasoning.** ESPN covers both DM-105 leagues with scores, schedules, and team
marks at no cost and no key. The known risk — it is an undocumented backend
with no SLA, retired as a public API in 2014 — is mitigated structurally
rather than by choosing a different primary: B3-001 puts every provider behind
an interface, B3-007 adds the second source, B3-008 flags disagreement for
review, and B4-004 keeps a manual override so a bad feed cannot auto-settle.

**Consequence.** Settlement correctness depends on an unsupported endpoint.
B3-003's circuit breaker and B10-004's data-outage test are load-bearing, not
nice-to-have.

---

## DM-108 — Jurisdictional posture ✅ CLOSED 2026-08-16

**Decision.** Testnet with non-redeemable test USDC. Implied, not marketed —
no testnet banner or notice in the product UI.

**Reasoning.** Owner decision.

**Consequence.** B10-008 keeps the end-to-end posture verification and drops
the UI disclosure; the Definition of Done line requiring it is removed. The
documentation still names Arc Testnet and links the Circle faucet, because
users cannot obtain funds otherwise — that is instruction, not posture.

---

## DM-110 — Dynamic Market Hook spec ⏸ BLOCKED

**Blocker.** No spec supplied. B0-003 (write the spec doc) and all six P0 tasks
in B2 depend on it, and B2 is scheduled for W2.

**What the spec has to answer.** Which v4 callbacks the hook uses (this fixes
the permission flags mined into the hook address in B2-002, and is not
changeable afterwards without redeploying); how the fee curve behaves across
pre-game, in-play, and near-resolution; how freeze enforcement reads market
state; what the fee cap is for the B2-008 invariant.

**Risk if it slips.** B2 is the critical path for the whole prediction market —
every league page stays empty until this hook is deployed.

---

## DM-111 — Agent wallet path ✅ CLOSED 2026-08-17

**Decision.** Keep the existing Circle Developer-Controlled Wallet path — it
IS the Circle wallet stack on Arc, and no migration is needed.

**B8-001 verification (2026-08-17, Circle docs).** `ARC-TESTNET` is fully
supported by Circle Wallets: wallet create/list, EOA + SCA account types,
transfers, contract execution (+ fee estimation), sign message / typed data,
Gas Station sponsorship, and (since 2025-11-25) the Contracts product. Source:
developers.circle.com/w3s/supported-blockchains-and-currencies and the
2025-10-27 / 2025-11-25 W3S release notes.

**Consequence.** The current agent stack (developer-controlled wallet per
user, USDC gas via Gas Station, server-side spending cap) carries into the
sports pivot unchanged. Two Circle-policy gaps remain tracked under B8-010:
per-service caps and time-bounded sessions are not yet mapped onto the cap
model; the contract allowlist half landed as B8-006 (server-side
`allowed-targets.ts` at the Circle execution choke point).

---

## DM-112 — Routing split ✅ CLOSED 2026-08-16

**Decision.** Market pools route directly to PoolManager / PositionManager.
Base pairs (USDC / EURC / cirBTC) continue through the Trading API path.

**Reasoning.** Outcome-token pools are created by Mantua, one per market, and
will not be indexed by third-party routing — direct calls are the only option
that works on day one. Base pairs already route through the existing path and
benefit from its quoting, so there is no reason to move them.

**Consequence.** The swap panel carries two routing paths. B7-003 must pick
between them by token type rather than assuming one.
