# 029 — Deposit / Withdraw UX (C-011 GAP-1, GAP-2, GAP-4)

**Status:** ✅ done
**Branch:** `029-deposit-withdraw-ux`

Closes three of the four gaps named by the C-011 flow trace
(`docs/tasks/023-usdc-denomination-flow.md`): the Deposit → Trade →
Withdraw mental model had a complete trade leg but no real UI for the
deposit or withdraw legs. Client-only — no server changes; the server
still holds no user keys.

## What was built

### GAP-1 — deposit affordance (`DepositCard.tsx`)

A deposit dialog opened from the profile page's Wallet section. "Your
wallet" tab shows the user's address with a copy button and a locally
generated QR code (`uqr`, exact-pinned, zero-dep — no network fetch), the
accepted-token list (USDC primarily; EURC/cbBTC as tradeable assets), and
the **one sanctioned network warning**: per the chainless carve-out in
`docs/architecture.md` ("Deposit → Trade → Withdraw (C-011)"), exchange
withdrawals must "choose the Base network" — fund-loss safety, and this
deposit surface is the only place in the app allowed to name a chain.

### GAP-2 — agent funding affordance (same dialog, second tab)

"Fund your agent" shows the agent wallet address (from
`useAgentPortfolio`) with the same copy/QR/warning affordances, plus a
one-tap **"Send from my wallet"** that opens the withdraw flow pre-filled
with the agent address as recipient. This is a _user-signed_ transfer, so
it does not cross the D-008 boundary (the agent path never touches the
user's Privy key). Not-provisioned / loading / error states are handled
(`AGENT_WALLET_NOT_FOUND` → "open the Agent panel to create one first").

### GAP-4 — user-wallet withdrawal (`WithdrawModal.tsx`)

The first in-app send from the user's own wallet: recipient address input
(strict `0x` + 40-hex validation), token select (USDC default; EURC,
cbBTC), amount input with a Max button fed by the live portfolio balance,
then a client-signed ERC-20 `transfer` via the existing
`useChainWalletClient` / `publicClientFor` pattern (same sign → receipt
flow as `use-market-trade.ts`), `waitForTransactionReceipt`, and a
portfolio refresh event on success. Copy is chainless throughout
("Withdraw USDC", "Review withdrawal" — no network names).

- **P1-005** — the send passes through the `useConfirmedAction`
  `confirm()` seam (severity `warning`, full recipient address shown in
  the confirmation) before any signature is requested.
- **B-016 ARIA** — `role="alert"` on validation/tx errors, `role="status"`
  on the success message, `aria-live="polite"` + `aria-atomic="true"` on
  the CTA button whose label walks the phases (Sign in wallet… →
  Confirming… → Sent).

### Entry points

`ProfilePage.tsx` only: **Deposit** and **Withdraw** buttons in the
Wallet section (withdraw disabled until a wallet is connected). The
deposit dialog's agent tab hands the agent address across to the withdraw
modal via local state.

### Not built here

GAP-3 (user redemption of winning positions after resolution) remains
open — it needs redeem calldata support and is a separate task.

## Files

- `client/src/features/portfolio/DepositCard.tsx` — new (GAP-1 + GAP-2)
- `client/src/features/portfolio/WithdrawModal.tsx` — new (GAP-4)
- `client/src/features/portfolio/withdraw-helpers.ts` — new pure helpers:
  `isValidEvmAddress`, `parseAmountRaw` (rejects over-precision instead of
  rounding), `clampToBalance`, `formatRawAmount`
- `client/src/features/portfolio/withdraw-helpers.test.ts` — node:test
  unit tests (address validation, parsing, clamping, round-trip)
- `client/src/features/portfolio/ProfilePage.tsx` — entry-point wiring
- `client/package.json` — `uqr@0.1.3` (exact-pinned QR encoder, zero deps)

## Gates

`npm run typecheck`, `npm run lint`, `npm test -w @mantua/client`,
`npm run build -w @mantua/client` — all clean at commit time.
