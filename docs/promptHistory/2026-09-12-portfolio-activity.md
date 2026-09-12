# Prompt History — Portfolio Management + Activity (Phase 9, task 062 onward)

**Date:** 2026-09-12
**Branch:** `claude/phase-9-portfolio-activity` (stacked on `claude/phase-8-agent-core`)
**Task:** Phase 9 PF-001 … PF-021; lane 062 (the activity spine).

## Original prompt (owner)

> continue with phase 9

(The rows come from the attached task list, "PHASE 9: Portfolio
Management + Activity 🔴 P0 · 21 rows · 0 done".)

## Refined prompt (as executed)

1. Survey the portfolio and activity surfaces against every PF-row
   (server routes and libs, the dormant `activity` table, client tabs,
   docs), then plan lanes by shared code.
2. **062 — the activity spine.** Extend the dormant table (status, actor,
   market / pool / position refs, asset, amount, value, uniqueness on
   tx + kind), a typed writer with a one-way status machine, a cursor-paged
   `GET /api/activity` across the user's id, wallet and agent wallet, and
   best-effort fan-out at every money write site: fills, redeems, swaps,
   liquidity, agent trades and reads, Circle sends (pending → terminal),
   hedges, settlements, fiat transfers. Record as D-115.
3. Then 063 position economics, 064 the timeline UI + the chain-branding
   sweep, 065 the portfolio surfaces, 066 end-to-end + the pricing decision.

## Outcome

- Lane 062 landed (see `docs/tasks/062-activity-spine.md`).
- Lane 063 landed: `lib/lp-economics.ts`, `settledHistory`, potential payout,
  `GET /api/portfolio/economics` + `/settled` (see `docs/tasks/063-position-economics.md`).
- Lane 064 landed: `features/activity/` timeline + Activity tab, the
  chainless-branding sweep and its leak fixes (see `docs/tasks/064-activity-timeline.md`).
