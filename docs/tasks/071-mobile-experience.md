# Task 071 — Mobile Experience (Phase 15, MX-001 … MX-009)

> Numbering follows the owner's master list of 2026-09-16, refreshed
> 2026-09-19 (`docs/tasks/mantua-v1-task-list.md`), where Phase 15 is the
> mobile excellence pass, scheduled last. Phase 14 (Base Builder Code) is
> skipped for now at the owner's direction: the Base registration form
> answers "Something went wrong" and is with Base support.

**Branch:** `claude/phase-15-mobile`
**Prompt history:** `docs/promptHistory/2026-09-19-mobile-experience.md`
**Decision:** D-118 (`docs/decisions/v2-open-decisions.md`) — PWA first, native later.

## Description

Make Mantua the best mobile experience of any prediction market: everything
a user needs is a couple of taps away, on a phone, one-handed, at game
time. The responsive baseline (hidden sidebar + hamburger, single-column
actions — B-014) shipped through P0; this phase is the dedicated pass over
every P0/P1 flow with the couple-of-taps standard as the bar.

Three ideas carry the phase:

1. **The ticket comes to the thumb.** Below `lg` a price tap slides the
   trade ticket up as a bottom sheet with Confirm in the thumb zone. It is
   the same `TradeTicket` the desktop sidebar renders — no second flow, no
   second tap budget. Three taps to a trade, two to exit, as before.
2. **Notifications ride the activity spine.** Every money path already
   reports to the unified activity table (D-115), so trade confirmations,
   agent actions and settlement become pushes from one seam. Game events
   and position alerts come from the live-sync tick that already reads the
   scores. Web Push is implemented on `node:crypto` alone — RFC 8291
   encryption verified against the RFC's own vector, RFC 8292 VAPID — with
   no new dependency, and every send is idempotent per (user, tag).
3. **The installed app is the PWA.** A manifest, a service worker that
   caches only immutable assets and the shell (never `/api/`), an earned
   install offer, and launch routes (`?open=…`) that notifications and
   home-screen shortcuts land on. Native packaging is deferred (D-118).

## Success criteria

1. Every P0/P1 flow is audited on a phone against the couple-of-taps
   standard, with each count proven by a browser spec at a small (360 px)
   and a large (430 px) viewport (`docs/design/mobile-audit.md`). (MX-001)
2. A trade is three taps in a bottom sheet — price, preset, Confirm — with
   Confirm's centre in the lower 60 % of the viewport and every trade
   control at least 44 px tall. (MX-002)
3. A game in progress shows score, the held side's price now, its value and
   P&L, and the exit, in one card on the league page; leaving the position
   is two taps from that card. (MX-003)
4. Push notifications for trade confirmations, position alerts, game
   events, agent actions and settlement, each a topic the user can switch;
   permission is requested only from a tap; nothing is sent twice for one
   event; a deployment without keys sends nothing and never asks. (MX-004)
5. The hold-to-speak control keeps recording while a finger drifts off it,
   releases when the page hides or the gesture is cancelled, is a 44 px
   target on phones, and never triggers the long-press menu. (MX-005)
6. Budgets for the first tappable market row on a throttled mid-tier
   profile and for the gzipped JavaScript on the critical path, as
   constants with rationale, enforced against the production build; the
   heavy vendor libraries are off the critical path. (MX-006)
7. The app is installable (manifest, icons, service worker), opens to a
   named surface from a notification or a shortcut, and offers the install
   only once earned, respecting a dismissal. Decision recorded. (MX-007)
8. Portfolio, positions, agent status and account are one tabbed page on
   a phone, positions first; the Close/Lock-in, Confirm and chip controls
   are full touch targets. (MX-008)
9. A benchmark against competing prediction-market phone apps on
   taps-to-trade, taps-to-exit, taps-to-switch-sport and load time, with
   Mantua's numbers measured by the suite and the comparison sources
   named. (MX-009)

## Failure conditions

- A second trade flow, parser, or tap budget for mobile.
- A push that could execute, confirm, or reveal anything: pushes carry a
  title, a sentence and an in-app path only.
- The VAPID private key reachable from the browser, or in a tracked file.
- A notification sent twice for one fill, one tick, or one settlement.
- The permission prompt on page load.
- Anything under `/api/` cached by the service worker.
- A budget in a test without a rationale in `mobile-budgets.ts`.
- A trade control under 44 px on a phone.

## Edge cases

| Case                                             | Behaviour                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Price tap on a tablet (768–1023 px)              | The sheet, not the sidebar: the stacked column would put the ticket a screen below the tap.        |
| Deep link with a game and side                   | The sheet opens on that side; the list's default selection never opens it.                         |
| "Trade executed" inside the sheet                | The card stays until the user closes the sheet or taps View position / Trade again.                |
| Finger slides off the mic                        | Pointer capture keeps the press; release ends it.                                                  |
| Call arrives mid-press                           | `visibilitychange` releases; whatever was committed is judged as a normal release.                 |
| Push service says the subscription is gone (410) | The row is deleted; the browser re-subscribes on its next visit to the settings.                   |
| Two instances react to one fill                  | Both try to claim the (user, tag) delivery row; the unique index lets exactly one send.            |
| Position moves 12¢ up, back to 5¢, then 15¢ up   | One alert (the +1 step tag); the return trip and the second climb into the same step send nothing. |
| NO position held                                 | Alerts and the glance price the away side; the one-tap exit is absent (B7-003 sells YES only).     |
| No VAPID keys on the deployment                  | `GET /api/push/config` says disabled; the settings say so; the tick runs no alert queries.         |
| iOS Safari in the browser                        | Push is unavailable until the app is on the home screen; the settings say exactly that.            |
| Install dismissed                                | Not offered again for fourteen days, or ever inside the installed app.                             |
| Offline in the installed app                     | The shell and the hashed assets load from cache; every API read fails honestly (R-005's banner).   |

## Implementation checklist

### Server (MX-004)

- [x] `db/schema/push.ts` — `push_subscriptions`, `push_deliveries`; migration
      `0023_push_subscriptions.sql` (journal idx 23; Phase 13's PR #58 holds
      idx 22 — merge order resolves the journal).
- [x] `env.ts` — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
      shape-validated, optional; `scripts/push-generate-keys.ts`.
- [x] `lib/push/vapid.ts` (+ test) — ES256 JWT, `Authorization: vapid …`.
- [x] `lib/push/encrypt.ts` (+ test) — RFC 8291 `aes128gcm`, byte-exact
      against Appendix A, plus a round trip and the size/shape refusals.
- [x] `lib/push/send.ts` (+ test) — headers per RFC 8030, outcomes mapped.
- [x] `lib/push/topics.ts`, `push-events.ts`, `notifications.ts` (+ test) —
      the five topics and the catalogue; no chain vocabulary.
- [x] `lib/push/dispatch.ts` (+ test) — claim-then-send, gone → removed.
- [x] `lib/push/push-store.ts` — the Drizzle store, keys from env.
- [x] `lib/push/activity-bridge.ts` (+ test) — activity row → event; hooked
      into `recordActivity` after a successful insert, fire-and-forget.
- [x] `lib/push/live-alerts.ts` (+ test), `live-alerts-db.ts`,
      `live-alerts-run.ts` — game transitions and 10¢ position steps,
      run from `cron-live-sync.ts`.
- [x] `routes/push.ts` (+ test) — config, subscribe, topics, unsubscribe,
      test; registered in `app.ts`; every mutating route guarded.

### Client

- [x] `lib/mobile.ts`, `hooks/use-media-query.ts` — the breakpoints and the
      44 px target as constants.
- [x] `components/ui/sheet.tsx` — `side="bottom"`, safe-area padding, handle;
      `features/markets/ticket/TradeSheet.tsx`; `LeaguePage.tsx` opens it
      on a price tap or a deep link below `lg`. (MX-002)
- [x] `GameRow`, `TicketAmount`, `TicketSides`, `TicketExecuted`,
      `MarketPositionsSection`, `DiscoverPage`, `MarketDetail`,
      `CircleAgentChat` — 44 px targets on phones. (MX-002, MX-008)
- [x] `features/markets/live/live-glance-core.ts` (+ test), `LiveGlance.tsx`
      on the league page. (MX-003)
- [x] `features/markets/SportChips.tsx` in `LeagueHeader` — one-tap sport
      switching. (MX-001)
- [x] `features/notifications/push-core.ts` (+ test), `use-push.ts`,
      `NotificationSettings.tsx` in the profile; `api.delete`. (MX-004)
- [x] `features/voice/press-events.ts` (+ test), `MicButton.tsx` retuned,
      `voice-transport.ts` resumes a suspended context, `InputBar` at 16 px
      with `enterKeyHint`. (MX-005)
- [x] `app-lazy.ts`, Suspense in `AppShell` and `main.tsx`, the chart lazy
      in `MarketDetail`, the funding modals lazy in `ProfileWalletSection`;
      `vite.config.ts` splits the bridge, Solana, chart and funding vendors;
      `lib/mobile-budgets.ts`. (MX-006)
- [x] `public/manifest.webmanifest`, icons (`icon-192/512`, maskable),
      `public/sw.js`, `lib/register-sw.ts`, `index.html` meta, theme-color
      sync, `lib/launch-route.ts` (+ test) wired into `App.tsx`,
      `features/pwa/` install offer (+ test) and banner. (MX-007)
- [x] `features/portfolio/MobileProfile.tsx`, `ProfileWalletSection.tsx`;
      `App.tsx` renders it for the profile route below `md`. (MX-008)

### Suites and docs

- [x] `playwright.mobile.config.ts` — the production build under `vite
preview`, two Chromium phone projects; `npm run e2e:mobile`.
- [x] `e2e/mobile/` — trade (3 taps, thumb zone), exit (glance, 2 taps,
      tabbed profile), switch (chips, discover, dock targets, no horizontal
      overflow), pwa (manifest, SW, launch routes, settings state), perf
      (throttled cold + warm), bundle (critical bytes, deferred vendors).
- [x] `.github/workflows/e2e.yml` — the mobile job beside the desktop one.
- [x] `vercel.json` — `sw.js` served uncached.
- [x] `docs/design/mobile-audit.md`, `docs/design/mobile-benchmark.md`,
      `docs/ops/push-notifications.md`, D-118, `docs/architecture.md`,
      `docs/tasks/v2-roadmap.md`, `docs/design/notes.md`, `README.md`.
- [x] Lint, typecheck, both unit suites, both browser suites, the formatter.

## Notes

- **No new dependency.** Web Push needs ECDH, HKDF, AES-128-GCM and ES256;
  `node:crypto` has all four. The RFC 8291 Appendix A vector reproduces
  byte for byte, which is a stronger guarantee than a library's changelog.
- **Why the activity spine.** Hooking every money path separately would
  have meant five call sites and five ways to forget one. `recordActivity`
  is already the place a fill, a hedge, an agent trade and a settlement
  must report to (L-013), so it is the one place they become pushes.
- **What a push can do.** Open the app at a path. Never confirm, never
  execute, never carry a balance or an address.
- **Tablets get the sheet.** Between 768 and 1023 px the layout stacks and
  the sidebar ticket would land below the fold of the tap that opened it;
  the sheet is the right answer there too (design notes §Viewport).
- **The bundle.** Before this task the app shipped one 1.63 MB (gzip)
  vendor chunk to every visitor. The Circle bridge kit and adapters, the
  Solana libraries, the charting library and Plaid are only needed by
  surfaces a phone rarely opens; they now load with those surfaces
  (226 kB deferred). The app itself is 340 kB gzip on the critical path.
  What remains in production is the wallet stack the auth provider needs
  on every page (1.39 MB) — the next cut is an auth-provider decision, not
  a build setting, and is recorded in the benchmark. Two rolldown lessons
  are written into `vite.config.ts`: `manualChunks` compat is one
  name-function group, and a module shared between group chunks goes to
  the highest-priority group, so `vendor` must outrank the leaves.
- **Found and fixed on the way.** The settled-positions and LP-economics
  sections dereferenced a response without its rows; they now treat that
  as "not loaded". The header overflowed a 360 px phone by 23 px when
  logged out; it fits now.
- **Owner-gated.** Mint VAPID keys (`npm run push:generate-keys -w
@mantua/server`) and set the three env vars on the deployment; until
  then the feature is dark by design. The competitor rows in the benchmark
  are from published app flows and need a device run to become measured.
