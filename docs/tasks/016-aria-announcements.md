# 016 — ARIA announcements (B-016)

**Status:** ✅ done
**Branch:** `016-aria-announcements`

The v2 reusability audit (docs/architecture.md → "v2 reusability audit" → Design system)
found zero `aria-live` / `role="alert"` / `role="status"` in the client — no error,
loading state, or transaction result was ever announced to assistive tech. This task
adds them, hardens the `doubleConfirm` flow, swaps LoginModal onto the shared Radix
dialog shell, and labels the shell input.

Conventions applied:

- **Errors** that mount *with* their content → `role="alert"` (assertive, announced once
  on mount).
- **Progress / loading / transaction results** → `role="status"` on message elements
  (implicit polite live region), and `aria-live="polite"` + `aria-atomic="true"` on CTA
  buttons whose visible label walks through tx phases ("Preparing… → Approve in
  wallet… → …complete") — the label change announces politely without disturbing the
  button role. Nothing announces assertively for status changes.

## Inventory

| File | What was added |
| --- | --- |
| `client/src/features/swap/SwapPanel.tsx` | `role="alert"` on the 3 red errors (quote failure, bridge error, swap error); `role="status"` on "Fetching quote…" and the swap/bridge progress messages; `aria-live="polite"` + `aria-atomic="true"` on both CTA buttons (phase labels "Preparing… → Approve in wallet… → Starting bridge… → …complete") |
| `client/src/features/liquidity/AddLiquidityForm.tsx` | `role="alert"` on the add-liquidity error; polite live CTA button (creating-pool / approving / signing / pending phases) |
| `client/src/features/liquidity/RemoveLiquidityModal.tsx` | `role="alert"` on the remove error and the amber "tokenId capture" warning; polite live CTA button (Preparing… / Sign in wallet… / Confirming… / Done) |
| `client/src/features/liquidity/PositionsList.tsx` | `role="alert"` on load-failure; `role="status"` on "Loading positions…" |
| `client/src/features/liquidity/PoolDetailPage.tsx` | `role="alert"` on load-failure; `role="status"` on "Loading pool…" |
| `client/src/features/liquidity/LiquidityListPage.tsx` | `role="alert"` on load-failure; `role="status"` on "Loading pools…" |
| `client/src/features/portfolio/UnifiedBalanceTab.tsx` | `role="alert"` on balance + deposit errors; `role="status"` on "Loading balance…" and a wrapper around the "Deposit confirmed ↗" result (link role preserved); polite live deposit button ("Depositing…") |
| `client/src/features/portfolio/EarningsTab.tsx` | `role="alert"` on earnings + sweep errors; `role="status"` on "Reading fees…" and the "Fees collected" sweep result; polite live sweep button ("Collecting…") |
| `client/src/features/portfolio/AssetsCard.tsx` | `role="alert"` on portfolio + agent errors; `role="status"` on "Loading balances…" and "Loading agent wallet…" |
| `client/src/features/analyze/AnalyzePanel.tsx` | `role="alert"` on the error card; `role="status"` on "Pulling live data…" |
| `client/src/features/markets/MarketDetail.tsx` | `role="status"` on Loading comments/holders/positions/activity; `role="alert"` on the comment-post error |
| `client/src/features/markets/SlateList.tsx` | `role="status"` on "Loading {sport} games…" |
| `client/src/features/markets/LeaguePage.tsx` | `role="status"` on "Loading games…" |
| `client/src/hooks/use-confirmed-action.tsx` | doubleConfirm hardening: the amber second-stage warning gets `role="alert"`, and the confirm button's visible label becomes "{confirmLabel} — click again" on the second stage so a fast double-click faces two visibly different buttons. Public API unchanged. |
| `client/src/components/auth/LoginModal.tsx` | Replaced the hand-rolled fixed-overlay shell (no focus trap, manual Escape listener) with the shared Radix `Dialog`/`DialogContent`/`DialogTitle` from `components/ui/dialog.tsx` — focus trap, `role="dialog"`/`aria-modal`, Escape + overlay dismissal and the standard close button come from the wrapper; rendered content/styling unchanged (`max-w-sm`, same title size). Also: `role="alert"` on the yellow error, polite live Verify button ("Verifying…"), `aria-label` on the email and code inputs. |
| `client/src/components/shell/InputBar.tsx` | One-line `aria-label` on the main input (was placeholder-only). Only shell edit. |

## Deferrals

- **Amber inline warnings in SwapPanel** (hook-incompatible, insufficient-liquidity, and
  the "Swap rejected by hook / no pool" banner under the Sell card) were left without
  live-region roles: they can appear/re-evaluate per keystroke while the user edits the
  amount, so `role="alert"` would spam assertive announcements mid-typing. The blocked
  state still surfaces through the polite live CTA button label ("Hook unavailable for
  this pair" / "Insufficient liquidity").
- **Chart placeholders** ("Loading price history…" / "No price history for this pair."
  in AddLiquidityForm and PoolDetailPage) — a single element toggling between a loading
  and an empty-state string; making it a status region would also announce the
  non-status empty state. Left silent (decorative chart fallback).
- **`PortfolioCard.tsx` "Loading history…"** — same shared-element pattern (toggles with
  "Connect wallet to see your portfolio"); left silent.
- **`AssetDetailPanel.tsx` `text-red` outcome span** — static per-row tx history data
  inside a list, not a live error; no announcement needed.
- **`features/agent/**` and `features/command-bar/**`** — owned by another agent; not
  touched (the command-bar/agent chat stream has its own announcement needs).

## Gates

- `npm test -w @mantua/client` — 84/84 pass.
- `npm run typecheck` / `npm run lint` — fail **identically before and after** this
  change: the worktree's symlinked `node_modules` (shared from the main repo, install
  forbidden) is missing `@privy-io/react-auth` and other packages, producing 53
  pre-existing TS errors and 504 pre-existing type-aware lint errors. Verified by
  stash-diffing: the error/finding sets with and without this change are byte-identical
  (modulo line-number shifts in LoginModal). This branch introduces zero new findings.

## Merge reconciliation with B-015 (2026-09-04)

B-015 landed first and replaced the portfolio tabs' copy-pasted
`px-4 py-8 text-center` divs with the `EmptyState` primitive — the same
divs this task had annotated with `role="alert"` / `role="status"`.
Resolved by moving the semantics **into the primitive**: `EmptyState`
now renders `role="alert"` for `tone="error"` and `role="status"`
otherwise, per the wave spec's rule that accessibility semantics live in
the primitive, never the call site. Net effect is strictly better than
either branch alone — every current and future `EmptyState` announces
correctly without the call site opting in.
