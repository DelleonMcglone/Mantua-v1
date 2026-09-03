# 014 — Navigation reconciliation (B-014)

**Status:** ✅ done
**Branch:** `014-navigation-reconciliation`
**Inputs:** `docs/design/notes.md` (v2 responsive rules), `docs/design/components.md` (Sheet row: "PD-007 deviation; Phase D follow-up"), `docs/architecture.md` → "v2 reusability audit" → Design system (4 independent header implementations; MarketNav double-rendered wide/narrow; AppShell merely stacks at mobile widths).

Goal: reconcile the existing navigation / sidebar / quick-action surfaces with
the sports-market information architecture (leagues → games → market detail,
`client/src/features/markets/`) **before** duplicates get created, and land the
mobile design guidance: hidden sidebar + hamburger navigation, single-column
action layouts on mobile.

## Reconciliation map

Every navigation need, its one canonical component, and the duplicate that was
about to exist:

| Navigation need | Canonical existing component | Duplication risk avoided |
| --- | --- | --- |
| League entry points (NFL, WNBA, NBA, MLB, NHL, Soccer → league page) | `shell/MarketNav.tsx`, driven by the `SPORTS` catalog in `features/markets/sports.ts` | A second hand-built league list inside a mobile drawer/sidebar. The new sheet renders `MarketNav layout="column"` — same `NAV_ITEMS`, same catalog, so a league added to `SPORTS` appears in desktop nav, landing nav, and the mobile sheet with one edit. |
| Section entry points (Agent, Trading) | Same `MarketNav.tsx` `NAV_ITEMS` (divider-separated tail items) | A separate "app sections nav" component next to the markets nav. |
| Games within a league | `features/markets/LeaguePage.tsx` + `SlateList.tsx` / `Board.tsx` (route content) | Per-game items leaking into header navigation. Games stay page content; the header stops at the league level — matches how the IA is navigated today (`Board.onOpenLeague` / `onTrade`). |
| Market detail | `features/markets/MarketDetail.tsx`, reached via `Board`/`SlateList` `onTrade` → `Route {kind:"market", selectEventId}` | Any header/nav surface for individual markets — none needed, none added. |
| In-app top bar | `shell/Header.tsx` (canonical; renders `WalletMenu` as-is) | A fifth header implementation. Header now also owns the mobile hamburger + sheet. |
| Public-page top bar (landing, docs, legal) | **New** `shell/SiteHeader.tsx` — one implementation of the shared border-b + Logo + nav-row + theme toggle + "Launch App" shell | The audit's 3 copy-pasted private headers (`landing/LandingPage.tsx`, `docs/DocsPage.tsx`, `legal/LegalPage.tsx`) — all three now render `SiteHeader`; their private header JSX is deleted. |
| Quick actions (agent / analyze / swap / liquidity) | `shell/HomeMenu.tsx` (`HomePromptRow`) | A separate mobile quick-action list. The sheet reuses `HomePromptRow columns="single"`; the prompt list stays defined once. |
| Mobile navigation (hidden sidebar + hamburger) | **New** `ui/sheet.tsx` (Radix Dialog — dependency already present via `ui/dialog.tsx`, nothing added) + `shell/MobileNavSheet.tsx` composing `MarketNav` + `HomePromptRow` | A bespoke drawer per surface, or a nav re-implemented inside the drawer. The sheet is pure composition of the two canonical components. |
| Command / chat entry | `shell/InputBar.tsx`, rendered once as the `AppShell` dock | Per-page input bars. Unchanged — already single-instance. |
| Wallet / account menu | `shell/WalletMenu.tsx` | Untouched (ownership boundary); Header renders it as-is in both desktop and mobile header rows. |
| Docs topic navigation | `docs/DocsPage.tsx`'s own grouped sidebar | Not merged into `MarketNav` — different IA (doc topics, not market destinations). Its collapse toggle stays; see deferrals. |

## What was implemented

- **`client/src/components/ui/sheet.tsx`** — slide-in side panel on
  `@radix-ui/react-dialog` (same primitive as `ui/dialog.tsx`; no new
  dependency). Left/right sides, token-styled, focus trap / Escape /
  overlay-close from Radix. Entrance keyframes `sheet-in-left` /
  `sheet-in-right` added to `index.css`. This closes the components.md
  "Sheet (Radix)" row.
- **Hidden sidebar + hamburger** (`shell/Header.tsx` + new
  `shell/MobileNavSheet.tsx`): below `md` the header shows a hamburger
  (`aria-label="Menu"`, `md:hidden`) instead of the old second
  `MarketNav` strip (the audit's "MarketNav double-rendered wide/narrow"
  in the app shell). It opens a left sheet with the `MarketNav`
  destinations in a single column plus the `HomePromptRow` quick actions
  in a single column. Desktop rendering unchanged. Quick actions are
  threaded `App.tsx → AppShell → Header` via a new optional
  `onQuickAction(HomePromptId)` prop (routes through the existing
  `promptToRoute`).
- **Single-column quick actions on mobile** (`shell/HomeMenu.tsx`):
  `HomePromptRow` grid is now `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
  (was `grid-cols-2 lg:grid-cols-4`), plus a `columns="single"` variant
  used inside the sheet so it stays one column regardless of viewport.
- **Header consolidation** (`shell/SiteHeader.tsx`): landing, docs, and
  legal pages now share one header implementation. Per-caller differences
  are preserved as props so rendered output is unchanged: landing keeps
  its `gap-4 lg:gap-6` row, league nav + narrow nav strip, and
  non-interactive logo; docs keeps its `gap-3` row, sidebar-toggle
  hamburger (passed as `leading`), "Docs" tag, and back-to-home logo
  button; legal keeps the minimal `gap-4` row + logo back button.
- **`shell/MarketNav.tsx`**: new `layout="column"` rendering for the
  sheet — same `NAV_ITEMS`, vertical single-column list with hairline
  dividers.

Chainless rule respected: nothing touched renders chain names or badges.

## Where headers genuinely differ (and stay separate)

- **`shell/Header.tsx` vs `SiteHeader`** — the in-app header carries auth
  state (WalletMenu / Log in + Sign up), a larger logo (30px/17px vs
  28px/15px), `ui/Button` primitives, and the mobile nav sheet. Forcing it
  into `SiteHeader` would mean a prop for every difference with no shared
  behavior left; the shared *pattern* (border-b, logo group, nav row,
  right-aligned action cluster) is aligned by construction instead.
- **Docs hamburger vs shell hamburger** — the docs header's `lg:hidden`
  toggle collapses the docs *topic sidebar* (page content), not the market
  nav; it stays with `DocsPage` and is injected via `SiteHeader`'s
  `leading` slot.

## Deferrals

- **Landing page below `md`** keeps the scrollable `MarketNav` strip
  rather than a hamburger sheet: logged out there are no quick actions to
  put in a sheet, and the strip is the landing's designed treatment. If
  the guidance later extends to the marketing page, `MobileNavSheet`
  composes in directly (omit `onQuickAction`).
- **AppShell right-panel slide-in sheet** (notes.md v2 rule for
  768–1279px) and **<768px bottom navigation / slide-up panels** are not
  part of this task; the two-column grid still stacks. `ui/sheet.tsx` is
  the building block for that follow-up (PD-007 / Phase D).
- **Docs sidebar** keeps its show/hide toggle instead of migrating to
  `ui/sheet.tsx`; adopting the sheet there (for focus-trap parity) is a
  cheap follow-up now that the primitive exists.

## Files changed

- `client/src/components/ui/sheet.tsx` (new)
- `client/src/components/shell/MobileNavSheet.tsx` (new)
- `client/src/components/shell/SiteHeader.tsx` (new)
- `client/src/components/shell/Header.tsx` (hamburger + sheet; strip removed)
- `client/src/components/shell/MarketNav.tsx` (`layout="column"`)
- `client/src/components/shell/HomeMenu.tsx` (single-column mobile; `columns` prop)
- `client/src/components/shell/AppShell.tsx` (`onQuickAction` pass-through)
- `client/src/App.tsx` (wire `onQuickAction` → `promptToRoute`)
- `client/src/components/landing/LandingPage.tsx`, `client/src/components/docs/DocsPage.tsx`, `client/src/components/legal/LegalPage.tsx` (private headers → `SiteHeader`)
- `client/src/index.css` (sheet keyframes)

Gates at commit time: `npm run typecheck`, `npm run lint`,
`npm test -w @mantua/client` (84 pass), `npm run build -w @mantua/client` —
all clean. (Note: the shared `client/node_modules` in the main checkout was in
an interrupted-install state during this task; the worktree was given a local
`client/node_modules` assembled from the intact package contents — no installs
run, main checkout untouched — so the gates above ran against real
dependencies.)
