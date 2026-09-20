# Prompt History — Home Page Restructure (Phase 19, task 075)

**Date:** 2026-09-20
**Branch:** `claude/agent-extended-social-reputation-dzi0fj` (continued from the Phase 18 head; PR #64 open)
**Task:** 075 — Phase 19 HP-001 … HP-009, added to the owner's master list 2026-09-19, 🔴 P0.

## Original prompt (owner)

> 🏠 PHASE 19: Home Page Restructure 🔴
>
> Added 2026-09-19 by owner request. Tiered 🔴 P0 despite its position —
> it sits at the end of the document so phase numbering stays
> sequential, but it gates launch: / is the front door, and the legal
> links the Terms gate depends on live on the landing page today.
>
> Intent: delete the standalone landing page, let / resolve to the home
> page for every visitor, and relocate the landing content into a
> footer on that home page.
>
> HP-001 Content inventory before deletion — record every block on the
> landing page and its disposition: into the home-page footer,
> relocated to an existing surface, or dropped. Nothing leaves the
> product without a recorded decision
> HP-002 Remove the standalone landing page and its route; / resolves to
> the home page (the Discover board) for every visitor
> HP-003 Build the home-page footer and move the surviving landing
> content into it
> HP-004 Decide and record what a logged-out visitor sees at / — board
> readable with the login prompt deferred to the point of trade, or a
> gated shell. The browser suite's logged-out spec asserts today's
> behaviour, so this decision has a test to update
> HP-005 Preserve legal reachability: Terms and Privacy stay linked from
> the footer — L-004 requires them live before mainnet and the one-time
> acceptance gate links to them
> HP-006 Router cleanup: no orphaned link, stale redirect, or dead
> import to the removed page anywhere in the client
> HP-007 Keep both consumer sweeps green over the new footer — the
> chain-branding sweep (PF-018) and the gas / ETH / network / explorer
> wording sweep (T-005)
> HP-008 Hold the mobile budgets: the 360 px and 430 px specs pass with
> no horizontal overflow, and the footer does not regress the
> critical-JS budget (MX-006)
> HP-009 Update the browser E2E specs that enter through the landing
> page, plus the logged-out spec

## Refined prompt

Delete `client/src/components/landing/LandingPage.tsx` and the
`Route` kind `"landing"` it lives behind in `App.tsx`, with these
resolutions of the open questions:

1. **HP-004's decision.** Board readable, login deferred to the point
   of trade — not a gated shell. This is not a new behavior: `home`
   (the `Board`) already works fully logged out (B5-007), proven today
   by `errors.spec.ts`'s "logged out: browsing works and the ticket
   asks to log in" test, which goes through `launchApp()` (landing →
   "Launch App" → home) and never hits a login wall until the trade
   ticket. Removing the landing step just means that already-correct
   behavior is what `/` shows immediately, with no interstitial and no
   extra click. Recorded as D-121.
2. **What survives, and where.** Full content inventory in the task
   document. Summary: the footer's own content (Documentation link,
   five social links, copyright, the three legal links) moves verbatim
   into a new home-page footer; the marketing content above it (hero
   banner, demo video, feature grid, FAQ) is dropped — there is no
   surface the owner named for it to move to, and the instruction is
   specifically to relocate landing content _into a footer_, not to
   preserve the whole page elsewhere.
3. **Where the footer lives.** Rendered inside `HomeFullPage` (the
   `home` route's content), below the board, in the same scrollable
   `main` the app shell already gives full-page routes — not in the
   persistent chat dock, which stays reserved for the input bar.
4. **Shared infrastructure kept as-is.** `SiteHeader`, `DocsPage`, and
   the `LegalPage` family (`TermsPage`/`PrivacyPage`/`MarketIntegrityPage`)
   are untouched components already used by more than just landing —
   only their `onBack`/`onLogoClick`/`onLaunch` targets move from
   `landing` to `home`.

Success: the criteria in `docs/tasks/075-home-page-restructure.md`.
Files ≤ 150 lines, no hardcoded secrets, the route-guard and
consumer-copy sweeps all pass, both Playwright suites green.

## Why the refined prompt is better

The original leaves two things implicit that change what gets built:
whether the "Discover board" language means the existing `home`/`Board`
route or the separate `discover` cross-league route (it's the former —
`Board` is already described in its own header comment as "the home
board"), and what "relocate into a footer" means for the marketing
content that isn't footer content (hero, video, features, FAQ). The
refinement resolves both from the existing code and the instruction's
own wording, and turns HP-004's open decision into a recorded one
(D-121) backed by a test that already proves the chosen behavior.

## Process notes

- PR #64 (Phase 18, task 074) is open and blocked on a GitHub Actions
  runner outage confirmed to be account-wide, not a code issue — one
  standing-down comment posted; this phase continues on the same
  branch per the branch rule rather than waiting on it.
- Task document written before code; checklist ticked as rows land.
- The o3 pre-review and Gemini code review were not reachable from
  this session; the repository's code-review pass stands in.
