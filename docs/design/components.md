# Component Map: Prototype → Shadcn primitives

PD-003 — for each pattern in the prototype, where it maps in the Shadcn primitives library and whether we need a custom variant.

| Prototype pattern | Shadcn primitive | Variant work | Lands in phase |
| --- | --- | --- | --- |
| Primary button (Connect Wallet, Confirm) | `button` | ✅ — `primary` variant baked into `client/src/components/ui/button.tsx` | PD-005 (done) |
| Ghost button (Cancel, Back) | `button` | ✅ — `ghost` variant baked in | PD-005 (done) |
| Chip / pill (filters, network selector, range toggle) | `button` | ✅ — `chip` variant baked in | PD-005 (done) |
| Icon button (theme toggle, header icons) | `button` | ✅ — `icon` variant baked in | PD-005 (done) |
| Card (Portfolio, Assets, route panel) | not a Shadcn primitive | Custom — `client/src/components/shell/Card.tsx` | PD-004 (done) |
| Modal / confirmation dialog | `dialog` (Radix) | Used as-is via `useConfirmedAction` hook | PD-005 (done) |
| Onboarding / welcome modal | n/a — removed; v2 ships login direct | — | n/a |
| Toast (transaction submitted, errors) | `sonner` (Shadcn ships sonner-based toast) | Add when first toast is needed | Phase 3 (P3-006) |
| Token selector dropdown | `popover` + `command` (combobox) | Custom token row template | Phase 3 (P3-001) |
| Network selector dropdown | `popover` + custom rows (single chain so list is trivial) | Reuse same pattern as token selector | Phase 3 (P3-001) |
| Amount input with MAX button | `input` + suffix | Custom — wrap `input` with MAX button | Phase 3 (P3-001) |
| Slippage input (percent) | `input` | Custom format + warning levels (P1-004) | Phase 3 (P3-003) |
| Tabs (Portfolio: Balances / LP / History) | `tabs` (Radix) | Used as-is | Phase 8 (P8-005) |
| Asset row (icon + name + qty + chevron) | not a primitive | Custom — `Card`-based row | Phase 8 (P8-003) |
| Asset icon (token glyph) | not a primitive | Custom — typed by symbol; Phase 0 prototype already has SVGs | Phase 8 (P8-003) |
| Toggle group (theme: dark/light) | `toggle-group` (Radix) | Used as-is | PD-006 (settings panel — defer to P2-013 settings) |
| Slider (slippage, density, remove-liquidity %) | `slider` (Radix) | Used as-is | Phase 4 (P4-007) |
| Sheet (mobile right-column collapse) | `sheet` (Radix) | Used as-is | PD-007 deviation; Phase D follow-up |
| Skeleton loader | `skeleton` | Used as-is | Phase 7 (P7-004) |
| OHLC chart | not a Shadcn primitive | `lightweight-charts` library per P4-002 | Phase 4 (P4-002) |
| Code block / hash with copy | not a primitive | Custom — uses JetBrains Mono + lucide `Copy` icon | Phase 3 (P3-006) |
| Settings rows (label / control) | not a primitive | Custom layout component | Phase 6 (settings restyle) |
| Banner / inline notice (peg status, slippage warning) | not a primitive | Custom — colored `Card` variant | Phase 5 (P5-003) |

## Convention

- Anything with state or focus management → use the corresponding Radix primitive via Shadcn's pattern (copy the file into `client/src/components/ui/<name>.tsx`).
- Anything that's just a styled div or composition → custom component under `client/src/components/<area>/`.
- Custom variants on `button` go in `buttonVariants` (CVA) so they're tree-shakable and typed.
- Don't reach for `@/components/ui/...` from inside `@/components/ui` — primitives don't import each other.

## "Adding a Shadcn primitive" checklist

When a new feature phase needs a primitive that isn't in `client/src/components/ui/` yet:

1. Run `npx shadcn@latest add <name>` (after `npm install` exists). The CLI uses `client/components.json` already wired in P0-004.
2. Verify the generated file lives at `client/src/components/ui/<name>.tsx`.
3. Replace any hardcoded color references with token utilities (`bg-bg-elev`, `text-text-dim`, etc.).
4. Add the mapping row to this file.
