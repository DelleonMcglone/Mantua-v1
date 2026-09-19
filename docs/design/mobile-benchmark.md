# Mobile benchmark — taps and speed vs competing prediction-market apps (MX-009)

> Phase 15, task 071, 2026-09-19. Mantua's numbers are measured by
> `client/e2e/mobile/` on the production build at 360 × 740 and 430 × 932
> (Chromium, touch, mobile UA) and by `vite build` for the byte counts.
> Competitor numbers are **from published app walkthroughs and store
> listings, not measured by us**; they are here to set the bar and are
> marked 🟡 until the owner runs the same journeys on a device. This
> document is the iteration log for MX-009: it is updated on every run
> that changes a number.

## Taps

| Journey (from the surface a user is on)     | Mantua (measured)                   | Polymarket app (published flow, 🟡)            | Kalshi app (published flow, 🟡)                 | Proof            |
| ------------------------------------------- | ----------------------------------- | ---------------------------------------------- | ----------------------------------------------- | ---------------- |
| Trade, from the market list                 | **3** — price → preset → Confirm    | 4–5 — market → Yes/No → amount → Buy → confirm | 4–5 — market → Yes/No → amount → Review → Place | `trade.spec.ts`  |
| Exit a live position                        | **2** — Sell / Lock in → Confirm    | 3–4 — portfolio → position → Sell → confirm    | 3–4 — portfolio → position → Sell → confirm     | `exit.spec.ts`   |
| Switch sport / category                     | **1** — chip row on the league page | 1–2 — category tabs on home                    | 2 — category browse                             | `switch.spec.ts` |
| All markets, from home                      | **1**                               | 1                                              | 1                                               | `switch.spec.ts` |
| See score + position + price of a live game | **0 extra** — the live glance card  | 2+ — market page, then portfolio               | 2+ — market page, then portfolio                | `exit.spec.ts`   |
| Open positions from the installed app       | **1** — home-screen shortcut        | n/a (native app)                               | n/a (native app)                                | `pwa.spec.ts`    |

Mantua's counts hold at both widths and on every run; the wallet's own
signature prompt sits outside the app and is not counted (T-002's rule),
which is also how the competitor flows are counted above.

## Speed

Profile: Chrome's "Slow 4G" (1.6 Mbps down, 750 kbps up, 150 ms RTT) with
a 4× CPU slowdown — a mid-tier Android on a fair connection
(`client/src/lib/mobile-budgets.ts`).

| Measure                                                    | 2026-09-18 (before)        | 2026-09-19 (after)                            | Budget                 |
| ---------------------------------------------------------- | -------------------------- | --------------------------------------------- | ---------------------- |
| First tappable market row, cold, app without the auth SDK  | not measured               | **2.5 s** (2566 / 2511 ms)                    | 6.0 s                  |
| First tappable market row, warm (service worker)           | not measured               | **0.2 s** (201 / 182 ms)                      | 2.5 s                  |
| JavaScript on that path, gzipped, app without the auth SDK | 1.63 MB (one vendor chunk) | **340 kB** in 6 chunks                        | 450 kB                 |
| Largest chunk on that path, gzipped                        | 1.63 MB                    | **273 kB** (`vendor`)                         | 350 kB                 |
| JavaScript on that path, gzipped, **production**           | 1.76 MB                    | **1.46 MB** (index 66 kB + vendor 1.39 MB)    | recorded, not enforced |
| Deferred off the path (bridge kit, Solana, charts, Plaid)  | 0                          | 226 kB, loaded by the surfaces that need them | —                      |

The suite cannot run the unshimmed build (the auth SDK will not initialise
without a real app id), so the production first-load is an estimate:
1.46 MB at 1.6 Mbps is roughly 7 s of transfer before parsing, against
the 2.5 s the app itself needs. **The remaining 1.39 MB is the auth
provider's wallet stack** — every wallet connector, its QR and phone
libraries, viem — shipped to every visitor on every page. No build
setting removes it (rolldown must keep viem whole, and the provider wraps
the root). Native competitor apps pay none of this on a warm start.

## Where Mantua is measurably ahead

- **Taps.** Three to trade and two to exit are one fewer than the
  published competitor flows, because the ticket has no separate review
  step: the review is the fee lines on the same surface as Confirm
  (T-008), and the live glance carries the exit.
- **One glanceable surface.** Score, both prices, the held side's price
  now, value and P&L in one card, with the exit on it. The competitor
  flows split these between a market page and a portfolio page.
- **Warm start.** 0.2 s to the first market row once installed; the shell
  and the hashed assets come from the service worker.

## Where Mantua is behind, and the next cut

- **Cold start in production** is dominated by the auth stack (above).
  The decision the owner needs to make: keep the current provider and its
  full connector set, configure it down (fewer connectors, no Solana), or
  move authentication to a lighter embedded-wallet path. Each is a
  product decision, not a build one; the benchmark will be re-run when
  it is taken. Target: production critical path under 600 kB gzip, cold
  first market row under 5 s on the profile.
- **Store presence.** Competitors are in the app stores; Mantua is an
  installable web app (D-118). Revisit when distribution needs it.

## How to re-run

```bash
npm run e2e:mobile -w @mantua/client
```

prints `[mobile-budget] …` lines with the cold/warm times and the bytes
per chunk. For the production figure, `npm run build -w @mantua/client`
and gzip the chunks `dist/assets/index-*.js` imports.

## Device run (owner-gated)

To turn the 🟡 rows into measurements: on one mid-tier Android and one
iPhone, from a cold install, count taps for the six journeys in each app
and time the first tappable market with a stopwatch on a throttled
connection. Record the date, device, OS and app versions here.
