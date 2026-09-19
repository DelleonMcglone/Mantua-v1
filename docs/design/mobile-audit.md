# Mobile UX audit — every P0/P1 flow against the couple-of-taps standard (MX-001)

> Phase 15, task 071, 2026-09-19. Counted on a phone (below `md`, 360 × 740
> and 430 × 932), from the surface a user is on, with the app already open
> and signed in. A "tap" is one touch inside the app; the wallet's own
> signature prompt is outside the app and is not counted (T-002's rule).
> Every count in the **After** column is asserted by the named spec in
> `client/e2e/mobile/`, which runs on every PR at both widths.

## The standard

Everything a user needs is a couple of taps away. Concretely: a trade is
three taps (T-002), an exit two (T-011), a sport switch one, a market one,
a position check one, and each of those taps lands on a 44 px target a
thumb can hit one-handed (`client/src/lib/mobile.ts`).

## Flows

| Flow                                        | Before (2026-09-18)                                                                                           | After                                                                                                                 | Proof                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Find a market from home                     | 1 tap ("Browse all markets"), or a typed phrase                                                               | 1 tap; also one home-screen shortcut ("Markets") and `?open=discover`                                                 | `switch.spec.ts`, `pwa.spec.ts`        |
| Switch sport                                | 2 taps (hamburger → league), on every page                                                                    | 1 tap on the league and Discover pages (sport chips); hamburger still 2 from elsewhere                                | `switch.spec.ts`                       |
| Pick YES / NO                               | 1 tap on the price, but the ticket rendered **below the whole game list** — a scroll of ~1 screen to reach it | 1 tap; the ticket slides up as a bottom sheet with that side pressed                                                  | `trade.spec.ts`                        |
| Trade (price → amount → Confirm)            | 3 taps, plus the scroll above; Confirm at the bottom of a stacked column                                      | 3 taps; Confirm's centre in the lower 60 % of the viewport; presets, sides and Confirm ≥ 44 px                        | `trade.spec.ts`                        |
| Trade from Discover                         | 1 tap to the league page with the side set, then the scroll                                                   | 1 tap opens the sheet on that side                                                                                    | `trade.spec.ts`                        |
| Monitor a live position                     | Wallet menu → Profile (2 taps), then scroll past the portfolio chart to "Market positions"; no score there    | 0 extra taps on the league page: the live glance shows score, both prices, the held side's price now, value and P&L   | `exit.spec.ts`                         |
| Sell / exit a live position                 | 2 taps from the profile's Close (Close → Confirm) after the 2 taps and scroll to reach it                     | 2 taps from the glance (Sell / Lock in → Confirm); still 2 from the profile's Close                                   | `exit.spec.ts`                         |
| Open the profile                            | 2 taps (wallet menu → Profile); the page stacked the portfolio card, assets card and account panel            | 2 taps; four tabs, positions first; also `?open=profile` and the "Positions" shortcut                                 | `exit.spec.ts`, `pwa.spec.ts`          |
| Agent status and controls                   | Hamburger → Agent (2 taps); no agent view inside the profile on a phone                                       | 2 taps to the agent; 1 tap to the Agent tab from the profile (status, agent positions, Open agent)                    | `exit.spec.ts`                         |
| Ask the agent / analyst                     | The dock, 1 tap to focus + type or hold the mic                                                               | Same; the mic and Send are 44 px, the field is 16 px (no iOS zoom), the keyboard's action key reads Send              | `switch.spec.ts`                       |
| Voice                                       | Hold-to-speak worked with a mouse; a finger drifting off the button ended the press; long-press opened a menu | Pointer capture keeps the hold; cancel, hide or blur release; no context menu; 44 px; iOS audio resumed               | `press-events.test.ts` (node)          |
| Notifications                               | None                                                                                                          | Five topics from the profile's Account tab; permission only on tap; iOS says when the home screen is the prerequisite | `pwa.spec.ts`, server `push/*.test.ts` |
| Install                                     | Browser-only                                                                                                  | Manifest, icons, service worker, an earned install offer; opens to a named surface                                    | `pwa.spec.ts`                          |
| Legal pages, docs, swap, liquidity, history | Loaded with the app                                                                                           | Loaded on demand; off the critical path                                                                               | `bundle.spec.ts`                       |

## What was wrong, specifically

1. **The ticket was a screen away.** `LeaguePage` laid the list and the
   ticket out as `flex-col` below `lg`, so the ticket sat under every game
   of the week. A price tap changed a sidebar the user could not see.
2. **Nothing was 44 px.** Price buttons were 33 px tall, presets 24 px,
   the profile's Close 18 px, the mic 24 px, the Confirm in the agent chat
   32 px. All measured now.
3. **Sport switching cost the menu.** The hamburger hid the league nav on
   every page; there was no in-page league switch.
4. **Live monitoring meant leaving the game.** Scores were on the league
   page, positions on the profile, prices in the ticket — three surfaces.
5. **The bundle.** One 1.63 MB (gzip) vendor chunk shipped to every visitor,
   most of it bridge, Circle, Solana and charting code a phone rarely
   needs (`docs/design/mobile-benchmark.md`).
6. **The address bar had no way in.** Routes lived in memory; a link, a
   shortcut or a notification could not name a surface.

## What stays two taps, and why

The hamburger stays (B-014): one nav surface shared with desktop instead
of a parallel bottom bar. Agent and Trading remain two taps from a page
that is not a league page or the profile; the dock's contextual chips
(T-016) and the profile's Agent tab make the common cases one.

## Touch-target rule

`TOUCH_TARGET_PX = 44` for anything on the trade path, the mic, Send, tabs
and Close; `INLINE_TARGET_PX = 36` for chips inside a scrolling row. The
specs measure bounding boxes; a class name is not evidence.
