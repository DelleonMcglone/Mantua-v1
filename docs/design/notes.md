# Mantua Prototype — Design Constraints

Captured from `Mantua Prototype.html` + `src/shell.jsx` + `src/panels.jsx` during PD-001. The prototype itself is the spec; this file lists non-obvious rules a reader can't see at a glance.

## Viewport & responsive behavior

The prototype hard-locks the viewport to 1400px:

```html
<meta name="viewport" content="width=1400" />
```

There is no responsive design — mobile layouts, tablet breakpoints, and resize behavior are **not specified**. Production must cover these (mobile users are real); we treat that as a deviation per PD-007 and design responsive collapse rules ourselves.

**v2 responsive rules** (deviation from prototype):

- ≥1280px: prototype layout (2-column grid, 340px-1fr / 460px-1.3fr).
- 768–1279px: 2-column collapses to single column; right-panel becomes a slide-in sheet.
- <768px: full mobile — ~~bottom navigation~~, slide-up panels, stacked Portfolio + Assets.

> **Superseded (B-014, 2026-09-04):** the "bottom navigation" rule above is
> replaced by **hidden sidebar + hamburger navigation**, with action layouts
> collapsing to a single column below 768px. The nav destinations and quick
> actions now live in a Radix-backed slide-in sheet opened from a hamburger
> in the header (`components/ui/sheet.tsx` + `shell/MobileNavSheet.tsx`)
> rather than a persistent bottom bar. Rationale: one nav surface shared with
> desktop instead of a parallel mobile-only stack, and the sheet primitive is
> reused for the 768–1279px right-panel slide-in above. See
> `docs/tasks/014-navigation-reconciliation.md`.

> **Phase 15 (task 071, 2026-09-19):** the rules above are now constants
> (`client/src/lib/mobile.ts`) and measured. Below `lg` (1024 px) the trade
> ticket is a **bottom sheet** (`ui/sheet.tsx` `side="bottom"`) opened by a
> price tap — tablets included, because the stacked column put the ticket
> below the fold of the tap. Below `md` the league page carries a sport-chip
> row (one-tap league switching), the live glance, and the profile is four
> tabs. Every trade control, the mic, Send, tabs and Close are ≥ 44 px on
> phones (`TOUCH_TARGET_PX`); inline chips in a scrolling row may be 36 px.
> Safe areas: the dock and the bottom sheet pad by `env(safe-area-inset-bottom)`;
> `viewport-fit=cover`. The mobile suite (`client/e2e/mobile/`) asserts all
> of it at 360 × 740 and 430 × 932.

## Theme switching

Driven by an attribute on `<html>`:

```html
<html data-theme="dark">
  <!-- default -->
  <html data-theme="light"></html>
</html>
```

The prototype implements both dark and light. **Both ship in v2.** Toggle persists in localStorage. The accent purple (`#8b6cf0`) is the same in both themes.

## Density

A CSS variable `--density: 1 | 0.82` scales paddings and gaps. Comfortable mode is `1`; compact is `0.82`. Production exposes this as a Settings preference per the prototype's settings panel.

## Typography

- **UI:** Inter, weights 300/400/500/600/700.
- **Numbers / addresses / hashes:** JetBrains Mono, weights 400/500/600. Use the `.mono` class (or token-equivalent utility) for any displayed number, address, tx hash, or chain ID.
- Both fonts loaded from Google Fonts in the prototype; v2 will self-host or use Vercel-edge fonts to avoid the third-party request and CSP complexity.

## Color palette

Palette extracted to `client/src/styles/tokens.css` as the canonical source. **Every color used in v2 code must reference a token.** No literal hex values in component code (lint rule incoming during Phase 9).

Roles:

- `--bg`, `--bg-elev`, `--panel`, `--panel-solid` — surfaces
- `--border`, `--border-soft` — strokes
- `--text`, `--text-dim`, `--text-mute` — text hierarchy
- `--accent`, `--accent-2` — primary purple actions
- `--amber`, `--amber-dim` — chart line + portfolio highlight
- `--green`, `--red` — semantic positive / negative
- `--chip`, `--row-hover` — subtle fills

## Radii

Three values: `--radius` 14px (cards), `--radius-sm` 10px (chips, dropdowns), `--radius-xs` 8px (small controls, scrollbar). Pills (toggle groups) use `border-radius: 99px` directly.

## Layout grid

Top-level layout (post-header):

```
┌─────────────────────────────────────────────────────────────┐
│  Header (full width, 18px 32px padding, border-bottom)      │
├──────────────────────────┬──────────────────────────────────┤
│  Left column             │  Right column                    │
│  ─────────────           │  ─────────────                   │
│  Portfolio card          │  Route-specific panel            │
│  Assets card (flex)      │  Chat / Pool / Swap / Agent...   │
│                          │  Input bar (sticky bottom)       │
│  340px – 1fr             │  460px – 1.3fr                   │
└──────────────────────────┴──────────────────────────────────┘
```

Outer padding: `calc(20px * var(--density))` vertical, `calc(32px * var(--density))` horizontal. Gap: `calc(20px * var(--density))`.

## Accessibility baseline

Prototype does not show focus states explicitly. v2 adds:

- WCAG 2.1 AA contrast across both themes (validate with a CI check).
- Visible keyboard focus on every interactive element (Tailwind `focus-visible:ring`).
- All buttons have accessible names; icon-only buttons get `aria-label`.
- Color is never the only signal — semantic green/red is paired with arrows or labels.

## Chain lock

Single chain — Base Mainnet (8453). The prototype shows a network dropdown but only Base is selectable. v2 keeps the dropdown for future-proofing but enforces Base at every boundary (Privy, viem, server validation).
