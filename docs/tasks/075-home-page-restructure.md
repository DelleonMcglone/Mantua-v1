# Task 075 — Home Page Restructure (Phase 19, HP-001 … HP-009)

> Added 2026-09-19 by owner request, 🔴 P0 despite sitting at the end of
> the master list (numbering stays sequential). It gates launch: `/` is
> the front door, and the legal links the Terms acceptance gate depends
> on (L-004/L-005) live on the page being deleted.

**Branch:** `claude/agent-extended-social-reputation-dzi0fj` (continued — PR #64/Phase 18 open, blocked on a GitHub Actions runner outage, not a code issue; see that PR's standing-down comment)
**Prompt history:** `docs/promptHistory/2026-09-20-home-page-restructure.md`
**Decision:** D-121 (`docs/decisions/v2-open-decisions.md`) — the home page is the one front door; logged out is board-first, not gated.

## Description

Mantua has run two entry surfaces since Phase 0: a public marketing
`LandingPage` at the default route, and the actual product (`home`,
built around the `Board` — today's games across the covered leagues)
one click behind it via "Launch App". The owner's instruction: delete
the standalone landing page, let `/` resolve to the home page for
every visitor, and relocate the landing content that must survive into
a footer on that home page.

Nothing else about the product changes. `home` already renders inside
the full app shell (header, board, dock) and already works logged out —
browsing is free (B5-007), the login gate sits at the point of trade,
confirmed today by `errors.spec.ts`'s "logged out: browsing works and
the ticket asks to log in" test. Removing the landing page's redirect
step means that behavior is now what a first-time, logged-out visitor
sees immediately at `/`, with no interstitial.

## Content inventory (HP-001)

Every block on `LandingPage.tsx`, and where it goes. Nothing is deleted
without a line here.

| Block                                                                              | Disposition                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SiteHeader` (logo, league nav, theme toggle, Launch App)                          | **Kept, unchanged, elsewhere.** Shared already with `DocsPage` and `LegalPage` — both standalone pages survive and keep using it. Its `onLogoClick`/`onLaunch` targets move from `landing` to `home` (the new front door).                                      |
| `Hero` (banner art + "Programmable Sports Agents" tagline)                         | **Dropped.** No surface asks for marketing art; the product — the live board — is now what a visitor sees first. The two PNGs stay in `client/public/assets/` (static, not bundled JS; harmless if unreferenced) in case a future marketing surface wants them. |
| `DemoVideo` (`/assets/demo.mp4`)                                                   | **Dropped**, same reasoning. Asset file left in place.                                                                                                                                                                                                          |
| `FeatureGrid` (Hooks / Agents / Analytics / Portfolio / Trading & Liquidity cards) | **Dropped.** This is sales copy about the hooks and the agent, duplicated nowhere the owner asked for; the home page is not the place for it.                                                                                                                   |
| `FAQ` (4 items)                                                                    | **Dropped**, same reasoning.                                                                                                                                                                                                                                    |
| `FooterLinks` → Documentation button                                               | **Relocated** into the new home-page footer, same label, same target (`DocsPage`, already a standalone page — unchanged).                                                                                                                                       |
| `FooterLinks` → Social Media row (X, Discord, Substack, Reddit, LinkedIn)          | **Relocated** into the new home-page footer verbatim (`social-icons.tsx` moves from `components/landing/` to `components/shell/` since the footer is shell-owned now).                                                                                          |
| Copyright line                                                                     | **Relocated** into the new home-page footer.                                                                                                                                                                                                                    |
| Legal links (Privacy, Terms of Use, Market Integrity)                              | **Relocated** into the new home-page footer, same labels, same targets (`LegalPage` variants — unchanged). Required by HP-005/L-004/L-005: the Terms acceptance gate on the trade ticket links here, and both must stay reachable without login.                |

## Success criteria

- `LandingPage.tsx` and its route are gone; `App.tsx` has no `"landing"`
  Route kind, no import of the deleted component, no dead branch.
- Visiting `/` — logged in, logged out, fresh session or a stored route
  — never shows a marketing page; a fresh/logged-out visit lands on
  `home` with the board visible and no login prompt (HP-004: board
  readable, login deferred to the point of trade — the existing,
  already-tested behavior, now reachable with zero clicks).
- The new footer renders on the home page with the Documentation link,
  the five social links, the copyright line, and the three legal links,
  every one reachable without authentication.
- `legal.spec.ts` passes unmodified (`page.goto("/")` then click "Terms
  of Use" / "Privacy" — it already assumes those buttons are live on
  `/` with no intermediate click, which is now true for the reason
  above rather than by coincidence).
- The two consumer-copy sweeps (`chainless-branding.test.ts` PF-018,
  `chainless-copy.test.ts` T-005) stay green with the new footer file
  in their scan scope.
- No orphaned import, dead route branch, or stale "back to landing"
  comment anywhere in the client.
- Mobile: no horizontal overflow on the home page at 360 px/430 px; the
  critical-JS budget (`CRITICAL_JS_GZIP_MAX_BYTES`, MX-006) holds —
  expected to _improve_, since the marketing bundle (hero art logic,
  demo video, feature grid, FAQ) was on the eager critical path via
  `App.tsx`'s direct import and is now gone, while the footer it's
  replaced by is a fraction of that code.
- Every changed/new file ≤ 150 lines; both Playwright suites, both
  workspaces' unit suites, typecheck and lint all green.

## Failure conditions

- A build or runtime path that still renders the deleted `LandingPage`.
- Terms, Privacy, or Market Integrity unreachable from `/` without
  login (breaks L-004/L-005 and the ticket's Terms gate).
- A logged-out visitor gated behind a login wall at `/` (that is the
  gated-shell option HP-004 explicitly did not choose).
- Either consumer-copy sweep failing because the footer's copy, or its
  file, was missed.
- A regression in the critical-JS budget or new horizontal overflow at
  either phone width.

## Edge cases

- A stored route from a previous session (`sessionStorage`) that used
  to fall back to `landing` on a corrupt/foreign value — falls back to
  `home` instead; `RESTORABLE_KINDS` never listed `landing`, so no
  change there.
- A shared `/agents/<handle>` link (Phase 13's public agent page) — its
  "back" affordance now returns to `home`, not the deleted landing page;
  unaffected otherwise, it never routed through landing.
- The installed-PWA launch path (`?source=pwa`, `launchedFromInstalledApp`)
  already skipped landing before this change — unaffected.
- A visitor with JavaScript disabled or on the very first paint before
  Privy's `ready` flag resolves — unchanged loading state, independent
  of landing.

## Implementation checklist

- [x] Task document, prompt history, content inventory (HP-001)
- [x] Home-page footer built and wired into `HomeFullPage` (HP-003)
- [x] Landing route and page removed; `/` resolves to `home` for every visitor; logged-out decision recorded as D-121 (HP-002, HP-004)
- [x] Legal reachability preserved from the new footer (HP-005)
- [x] Router cleanup: no orphaned link, redirect, or import (HP-006)
- [x] Both consumer sweeps green over the new footer (HP-007)
- [x] Mobile budgets held: no overflow at 360/430 px, critical-JS budget (HP-008)
- [x] E2E specs updated: `harness.ts`'s `launchApp`, the logged-out spec (HP-009)
- [x] Docs: master task list Phase 19, roadmap, D-121, architecture note
- [x] Review round, verification, commit, PR

## Notes

- **Review round.** The repository's code-review pass (`code-review main
high`; Gemini and o3 are not reachable from this session) returned one
  finding: HP-006's router cleanup missed a handful of comment-only
  "landing" references outside the files this change touched directly —
  `PublicAgentPage.tsx`, `MarketNav.tsx`, `sports.ts`, two spots in
  `App.tsx` (`loadStoredRoute`'s catch comment, `navDestinationToRoute`'s
  docstring), and `README.md`. Fixed; no code behavior changed, only
  stale wording describing a page that no longer exists.
- **Mobile budget, measured.** Critical JS gzip dropped from 350,258 B
  (Phase 18's build) to 347,220 B — confirms the prediction in the
  success criteria: the deleted marketing bundle (hero logic, demo
  video, feature grid, FAQ) was larger than the footer that replaced it.
