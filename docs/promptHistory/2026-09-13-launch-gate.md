# Prompt History — Launch Gate: E2E, Security, Legal (Task 067)

**Date:** 2026-09-13
**Branch:** `claude/admiring-tesla-4yvv4o`
**Task:** 067 — Phase 10 G-001 … G-018.

## Original prompt (owner)

> Please begin Phase 10: Launch Gate (E2E, Security, Legal)

No row table accompanied the directive (Phases 6–9 each came with one).

## Refined prompt (as executed)

Define the launch gate from what the repository already declares it to be
and close every part of it that can be closed from inside the codebase:

1. **Source the rows.** The gate is the union of the roadmap's "Launch
   gate" and "Public launch gate" (`docs/tasks/v2-roadmap.md`), Phase 9's
   `P9-001 … P9-013`, B10-010 ("production live end to end"), TD-005 (the
   browser E2E harness), and the open items in `docs/security/sign-off.md`
   and `docs/tasks/prediction-market-protocol.md` (M-01). Each becomes a
   `G-` row with a status and evidence.
2. **E2E.** Stand up the browser harness TD-005 names: Playwright driving
   the real client against the shipped API wire shapes, with the
   authentication SDK replaced by a shim under a build-time flag and the
   chain answered by a scripted JSON-RPC mock, so the journeys Discover →
   Trade → Executed → Exit, the error copy, the status banner, and the
   legal gate run in a real browser in CI. The contracts fork suite is
   already CI; the live-money leg stays owner-gated.
3. **Security.** A launch-gate review of the Phases 6–9 surfaces against
   the sign-off's rails table; API security headers; a static audit that
   every mutating route carries an auth or signature guard (allowlisted
   exceptions with reasons); a repository secret scan; a dependency
   triage with the non-breaking fixes applied and the rest recorded.
4. **Legal.** Bring the Terms and Privacy pages (and their counsel
   drafts) to the product as shipped — fee model, dispute window, in-play
   trading, sponsored transactions, agent autonomy, custodied agent
   wallet, bank rails — and record acceptance: a versioned acceptance
   table, a read/write route, and a one-time acceptance step in the
   ticket before the first trade.
5. **Honesty.** Counsel review, the dogfood window, the mainnet deploy,
   the funded live E2E, and the M-01 written acceptance are owner-gated;
   they are listed with what is prepared for them, never marked done.

## Why the refinement is better

The directive names three areas and no rows. Deriving the rows from the
repository's own gate definitions keeps Phase 10 consistent with the
nine phases before it and makes "the gate" a checkable list rather than
a feeling. The E2E gap is closed at the layer that was missing (a real
browser over the real client) without pretending the chain leg is live.
Legal is made enforceable — a recorded, versioned acceptance — instead of
a footer sentence. Every owner-gated item is stated as such with the
artifact the owner needs ready.

## Clarifications made without the owner

- **Browser E2E authenticates through a shim, not Privy.** Privy's SDK
  needs a live app id and its own network; the shim is aliased in only
  under `VITE_E2E_AUTH=shim` and never ships in a build.
- **The chain is mocked in the browser suite.** JSON-RPC replies are
  scripted so the executed-trade journey runs; the on-chain truth is the
  Foundry fork suite and the deployment-gated live run.
- **Terms acceptance is one tap, once.** The tap budget (T-002) counts
  the recurring path; a first-ever trade carries one additional tap.
- **Dependency fixes.** Only semver-compatible bumps are applied; the
  Privy bump that clears the `ws` advisory is recorded, not taken.
- The house o3 / Gemini review steps are not reachable here.
