# Wave B-014–B-017 — Finish the Design Audit's Middle Layer

> Master: `docs/tasks/sports-pivot.md` — the wave runs alongside the B0–B10 phases
> Spec: owner-approved design-debt wave spec, 2026-09-03 — four tasks, four PRs, one wave
> Snapshot: 2026-09-03 · 0 ✅ · 4 ⬜
> Status mirror: the Checklist below mirrors the owner's Phase 0 ledger Status column — flip a row here only when the ledger flips, and vice versa

The v2 reusability audit (`docs/architecture.md` — "Design system") kept the token/theme foundation and condemned the component layer above it: hand-rolled dropdowns, ARIA-free tab systems, divergent USD formatters, an inline-style agent surface that renders the wrong hue in light mode, and zero `aria-live`/`role="alert"` announcements client-wide. The owner's Phase 0 ledger carries the resulting four open tasks — B-014 (navigation IA reconciliation), B-015 (design-system middle layer), B-016 (accessibility announcements), B-017 (chain-context deletion) — all ⬜; this document is their in-repo tracking surface. The wave executes them as four separate PRs, one branch per task named to its identifier, after the docs-only D-110 wallet reconciliation (PR #1) merged (1257a4e) so the migration-table reference in B-017 resolves on main. Execution order: B-017 → B-015 → (B-016 ∥ B-014) — B-017 first because its collapse sweeps ~25 files and minimizes cross-PR conflicts; B-016 and B-014 both consume B-015's primitives (toast, sheet). Where the audit's prose counts differ from the component research done for the wave spec (5 hand-rolled dropdowns vs 6 verified implementations; 6 divergent formatters vs 6 named helpers + 1 inline variant = 7 sites), the rows below use the research counts; the audit's verdicts are unchanged.

## Success Criteria

- [ ] Navigation reconciles with the sports-market IA: MarketNav renders from `sports.ts` coverage (NFL and WNBA live; NBA/MLB/NHL/Soccer show "Coming soon" per DM-105) instead of listing all six sports unfiltered; below 768px the sidebar hides behind hamburger navigation and action layouts collapse to a single column — superseding the prototype-derived "bottom navigation" rule at `docs/design/notes.md` L18, with the supersession recorded here (B-014)
- [ ] The design-system middle layer exists: one shared dropdown primitive (Radix Popover + cmdk Command) has replaced all 6 hand-rolled open/close + click-outside implementations (TokenSelector, HookSelector, BridgeDestinationSelector, WalletMenu, the LeaguePage week picker, the LiquidityListPage category filter); Radix tabs with `tablist`/`tab`/`aria-selected` have replaced both ARIA-free 5-way tab systems (AssetsCard, MarketDetail); one `lib/format.ts` `formatUsd` serves all 7 USD formatter sites; the agent surface is off inline styles onto Tailwind + tokens (~83 hardcoded rgba sites) with `Banner`/`TxRow`/`Skel` promoted into `components/ui/` (B-015)
- [ ] Errors, loading states longer than ~1s, and transaction results announce exactly once to assistive tech — politely for status, assertively for failures — where today the client-wide count of `aria-live`/`role="alert"` is zero (B-016)
- [ ] `client/src/lib/chain-context.tsx` (`ChainProvider`, `useCurrentChainId`, `useChainSwitch`) and the dead `NETWORK_OPTIONS` module are deleted and every consumer collapses to the Base-only chain constant — completing step 4 of the D-110 six-step migration table in `docs/decisions/v2-open-decisions.md` (B-017)

## Failure Conditions

- A second USD formatting path appears outside `lib/format.ts` — two helpers disagreeing on the missing-value sentinel is the exact trust bug this wave exists to kill
- An `aria-live` region announces twice, or failure copy vanishes with its toast's auto-dismiss
- A dropdown or tabs call site keeps bespoke Escape/typeahead/ARIA logic instead of consuming the primitive — accessibility semantics live in the primitive, never the call site
- Navigation ships as a parallel stack beside the existing sidebar/quick-action components instead of adapting them
- Any hardcoded rgba literal remains in `features/agent/` — light mode still renders the wrong hue
- A lingering `chain-context` import, or a test that relied on chain mocking fails after the collapse
- Nav ignores `sports.ts` coverage — a "Coming soon" sport renders as tradable
- PRs land out of dependency order — B-016 before B-015's toast primitive exists, or B-014 before its sheet primitive

## Edge Cases

- `useChainSwitch` has zero consumers, so the B-017 collapse is mechanical — but ~24 consumer files each need the `BASE_CHAIN_ID` (8453) swap, pinned by the DM-104 chain lock
- WalletMenu is the only dropdown with Escape/`role="menu"` today; its bespoke behavior must come free from the shared primitive, not regress
- `NETWORK_OPTIONS` already has zero UI consumers; its module is deleted only if nothing else imports it
- Spinner sites announce only past ~1s so short loads stay silent
- MarketNav's coverage field drives DM-105 — a new sport flipping to covered must light up nav by data, not by a nav edit
- The stale DM-104 "Arc Testnet" line in `sports-pivot-decisions.md` is append-only decision history and stays untouched
- Adjacent audit rows — type-scale codemod, `ui/button` radius fix, LoginModal dialog shell, token cleanup, toggle-group primitive — are follow-ups, not wave scope

## Checklist

- [ ] B-014 — Navigation IA reconciliation: coverage-driven MarketNav from `sports.ts` (DM-105), hidden sidebar + hamburger navigation on mobile (Radix sheet), single-column action layouts; supersedes the "bottom navigation" rule in `docs/design/notes.md` L18 — audit ground: the "Missing primitives" row (sheet) and the REPLACE-hand-rolled-copies verdict
- [ ] B-015 — Design-system middle layer: shared dropdown primitive replacing the 6 hand-rolled implementations, ARIA tabs replacing the 2 hand-rolled tab systems, one `lib/format.ts` unifying the 7 USD formatter sites, agent surface off inline styles onto tokens — audit ground: the "Missing primitives", "Number/currency formatting", and "Agent-surface styling idiom" rows, all REPLACE
- [ ] B-016 — Accessibility announcements: `aria-live`/`role="alert"` at sites where zero exist today (errors, >1s loads, tx results) — audit ground: the "Accessibility" row, "the one user-facing defect class in this area"
- [ ] B-017 — Delete the chain-context machinery: `chain-context.tsx` collapse + dead `NETWORK_OPTIONS` removed, consumers collapsed to the Base-only constant — final step 4 of the D-110 six-step migration table in `docs/decisions/v2-open-decisions.md` (⬜ "per reusability audit")
