# Prompt History — Mobile Experience (Phase 15, task 071)

**Date:** 2026-09-19
**Branch:** `claude/phase-15-mobile` (from `main` at `ab94be6`)
**Task:** 071 — Phase 15 MX-001 … MX-009, on the owner's master list refreshed 2026-09-19.

## Original prompt (owner)

> We are skipping 🏗️ PHASE 14: Base Builder Code 🟡 bc Im waiting on Base
> support I get this error message when tryng to setup my builder code
> [screenshot: Base "Add Domain" form for https://www.mantua.ai/ answering
>
> > "Something went wrong. Please contact support."]
>
> Start on phase 15
>
> 📲 PHASE 15: Mobile Experience 🟡 (scheduled LAST per spec)
>
> Goal: the best mobile app experience of any prediction market platform —
> everything I need is just a couple of taps away. Responsive baseline
> ships throughout P0; this phase is the dedicated excellence pass.
> Existing design guidance: hidden sidebar + hamburger navigation and
> single-column action layouts on mobile.
>
> MX-001 Mobile UX audit of every P0/P1 flow against the couple-of-taps
> standard: mobile-first trading flow, easy sport switching, fast market
> discovery, easy YES/NO selection, easy position monitoring, easy
> sell/exit
> MX-002 Mobile-optimized trade flow: thumb-reachable ≤3-tap trading,
> bottom-sheet confirms
> MX-003 Mobile live-game experience: scores + positions + prices in one
> glanceable surface, optimized for mobile
> MX-004 Push notifications: trade confirmations, position alerts, game
> events, agent actions, settlement
> MX-005 Mobile voice: Scribe v2 Realtime push-to-talk tuned for mobile
> MX-006 Performance: mobile load/interaction budgets on mid-tier devices
> and poor networks; test on small and large mobile screens
> MX-007 PWA and/or native app packaging decision + implementation
> MX-008 Agent controls and portfolio fully accessible on mobile; minimize
> scrolling and navigation depth; ensure appropriate touch targets
> MX-009 Benchmark test vs competing prediction-market mobile apps; iterate
> until measurably best-in-class on taps-to-trade and speed

The owner then pasted the refreshed master task list (Phases 12 and 13
closed, 228 of 294 done); it was stored verbatim in
`docs/tasks/mantua-v1-task-list.md` with the header note updated.

## Refined prompt (as executed)

1. **One trade flow.** The bottom sheet (MX-002) wraps the existing
   `TradeTicket`; the tap machine, the quote path and the Confirm are
   unchanged, so T-002's three-tap proof and T-011's two-tap exit hold on
   a phone by construction. The sheet applies below `lg` (tablets too),
   opens on a price tap or a deep link, never on the list's default
   selection.
2. **Pushes from the seams that already exist.** Trade confirmations,
   agent actions and settlement come off the activity writer (D-115);
   game events and position alerts off the live-sync tick. Web Push is
   implemented in-house on `node:crypto` (RFC 8291 verified against the
   RFC's vector; RFC 8292 VAPID), following Phase 12's no-dependency
   precedent. Delivery is idempotent per (user, tag) through a unique
   index claimed before the send. A push can only open a page.
3. **PWA first (D-118).** Manifest, icons, a service worker that caches
   immutable assets and the shell only, an earned install offer, launch
   routes for notifications and shortcuts. Native packaging is deferred
   until app-store distribution is a growth need; a wrapper would reuse
   all of this.
4. **Budgets as contracts.** `mobile-budgets.ts` holds the mid-tier
   profile (Slow 4G, 4× CPU) and the numbers with their reasons; a second
   Playwright config runs the production build at 360 px and 430 px and
   enforces them (time to first market row cold and warm, critical gzip
   bytes, deferred vendors off the path). Lazy routes and vendor splits
   are what hold the budget.
5. **Touch targets are asserted.** 44 px for every trade control, the mic,
   Send, tabs and Close; the mobile specs measure bounding boxes rather
   than trusting class names.
6. **The audit and the benchmark are documents with evidence.** Each tap
   count cites the spec that proves it; competitor numbers are from
   published flows and are marked as such until a device run replaces
   them.

## What was verified

- Server: 6 new test files (encryption vector, VAPID, catalogue, send,
  dispatch, live-alert rules, activity bridge, routes); full suite green
  apart from the pre-existing local `server/.env` secret-scan hit, which
  does not occur in CI.
- Client: 5 new node suites (launch route, install offer, push core, live
  glance, press semantics); 325 tests green; typecheck and lint clean.
- Browser: the desktop suite (18 specs) green against the changed app;
  the mobile suite (12 specs × 2 viewports, 24 runs) green against the production
  build. Numbers recorded in `docs/design/mobile-benchmark.md`.
