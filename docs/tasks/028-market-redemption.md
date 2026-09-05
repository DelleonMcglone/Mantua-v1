# 028 — Market redemption (C-011 GAP-3)

> Gap record: `docs/tasks/023-usdc-denomination-flow.md` → GAP-3
> Branch: `028-market-redemption`
> Status: **code-complete** — end-to-end verification blocked on the Base
> Mainnet markets deployment (`MARKETS_BY_CHAIN` is empty until then; see
> the manual verification script below).

## The gap

Users could win but never collect. The contracts have always paid —
`Market.redeem()` burns the caller's winning tokens for $1 of USDC each,
`Market.redeemInvalid()` pays $0.50 per share of either side on a voided
market (`contracts/src/markets/Market.sol`) — and the operator sweep
(`reclaimSettledMarkets`, `server/src/lib/sports/markets-onchain.ts`)
already redeems the _treasury's_ tokens. But no user-facing route or UI
existed: winning and voided positions sat as worthless-looking balances
with no claim path.

## What shipped

The user-signed calldata pattern from the trade flow
(`market-trade.ts` → `use-market-trade.ts`), applied to redemption. The
server builds, the user signs, the server verifies the receipt after.

### Server

| File                                     | What it does                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/lib/sports/market-redeem.ts` | Pure helpers: state → function mapping (`redeem` on RESOLVED/SETTLED, `redeemInvalid` on INVALID — mirroring the sweep), no-arg calldata encoding, payout estimation ($1/winning share, $0.50 on INVALID), and `redeemableSides` (which of a holder's sides are worth claiming). |
| `server/src/routes/market-redeem.ts`     | Three endpoints, all `requireAuth`; the POSTs also take `writeRateLimiter` (the market-trade middleware stack).                                                                                                                                                                  |
| `server/src/app.ts`                      | Mounts `marketRedeemRouter`.                                                                                                                                                                                                                                                     |
| `server/src/db/schema/safety.ts`         | Adds `"market_redeem"` to the `AuditAction` union.                                                                                                                                                                                                                               |

- **`GET /api/markets/redeemable?address=0x…`** — the caller's claimable
  positions: finished markets (RESOLVED/SETTLED/INVALID from the DB, joined
  through events/leagues for display context) crossed with live on-chain
  `balanceOf`. Winning side only on a resolved market (winner taken from the
  `resolutions` log — a resolved market whose winner we can't verify reports
  nothing rather than promising a payout the contract would refuse); either
  side on INVALID. Returns `marketId`, `label`, `league`, `providerEventId`,
  `state`, `side`, `tokenAddress`, `balanceRaw`, `payoutRaw` (estimated USDC,
  6dp raw).
- **`POST /api/markets/redeem/calldata`** `{ marketId, chainId? }` →
  `{ to, calldata, state, functionName, payoutRaw }`. Picks the function
  from the market's **live on-chain state** (4 → `redeemInvalid`, 2/3 →
  `redeem`, else 409 `NOT_REDEEMABLE`), and verifies the authed wallet
  actually holds redeemable tokens (409 `NOTHING_TO_REDEEM` otherwise — the
  contract would revert `NothingToRedeem` anyway). **No spending-cap leg**:
  redemption is an inflow (winnings coming back), the deliberate opposite of
  the C-019 buy-side guard.
- **`POST /api/markets/redeem/record`** `{ txHash, marketId, chainId? }` —
  market-fills' trust-but-verify pattern: the tx must exist, have succeeded,
  and target the _market contract for that marketId_ (`factory.marketOf`).
  Stamps `market_positions.redeemedAt`/`redeemTxHash` for the tx **sender**
  (not the caller's word) and writes a `market_redeem` audit row via
  `logAudit`.

### Client

| File                                                | What it does                                                                                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/features/markets/market-redeem-core.ts` | Pure, React-free UI logic: phase → chainless button copy, busy detection, raw→USD payout math, and per-market claim grouping (a voided market lists two sides but one call pays both).                                  |
| `client/src/features/markets/use-market-redeem.ts`  | `useRedeemable(address)` (fetch + reload on `mantua:refresh-portfolio`) and `useMarketRedeem()` — the state machine: `idle → preparing → signing → confirming → done/error`, calldata → wallet sign → receipt → record. |
| `client/src/features/markets/ClaimWinnings.tsx`     | The claim surface: claimable rows with `usd()`-formatted payouts and a per-market "Claim winnings" button; `role="status"` progress, `role="alert"` errors (B-016). Renders nothing when there's nothing to claim.      |
| `client/src/features/portfolio/AssetsCard.tsx`      | Positions tab renders `<ClaimWinnings>` above the LP list.                                                                                                                                                              |
| `client/src/features/markets/MarketDetail.tsx`      | Renders `<ClaimWinnings providerEventId=…>` above the price chart when the viewed game is claimable for the connected wallet.                                                                                           |

Copy is chainless throughout: "Claim winnings", "Confirm in your wallet…",
"Claiming…", "Claimed" — no chain, gas, or transaction words.

### Graceful degradation (pre-deployment)

`MARKETS_BY_CHAIN` is empty until the Base Mainnet deployment. Nothing here
throws at import: `GET /redeemable` short-circuits to `{ redeemable: [] }`
(no on-chain markets → nothing claimable, and the UI renders nothing), and
both POSTs return 400 `BAD_CHAIN` ("Markets not deployed on this chain") —
the same shape `market-fills` uses.

## Tests

- `server/src/lib/sports/market-redeem.test.ts` — selector-by-state (both
  the on-chain enum and the DB strings, asserted to agree), exact 4-byte
  calldata selectors, payout math (incl. INVALID rounding-down), and the
  full `redeemableSides` truth table (winning side only, unknown winner →
  nothing, INVALID both sides at half, live markets → nothing).
- `client/src/features/markets/market-redeem-core.test.ts` — phase labels,
  busy gating, payout math, and claim grouping. (The hook itself is thin
  async orchestration over these helpers; the repo has no React test
  harness, so the pure core carries the coverage.)

## Manual verification (once markets deploy on Base Mainnet)

Prereqs: `MARKETS_BY_CHAIN[8453]` populated, a resolved (or voided) market,
and a test wallet holding winning tokens (place a small bet pre-kickoff on
the side that ends up winning, or on any side of a game that gets voided).

1. **Listing** — after the market resolves (cron-resolution has run), open
   the Portfolio → Positions tab. A green "Claim winnings" card should show
   the position with the correct payout ($1 × shares; half for a voided
   game). Cross-check the API directly:
   `curl -H "Authorization: Bearer $TOKEN" \
   "$API/api/markets/redeemable?address=$WALLET"`— expect one row per
claimable side with`payoutRaw` = on-chain balance (or half of it on
   INVALID).
2. **Claim** — click "Claim winnings", sign in the wallet. Expect phases
   Preparing… → Confirm in your wallet… → Claiming… → "Winnings claimed".
   Verify on-chain: the outcome-token balance is 0, USDC balance grew by
   the payout, and the market emitted `Redeemed(wallet, amount, payout)`.
3. **Bookkeeping** — `mantua_audit_log` has a `market_redeem` row with the
   tx hash; any `market_positions` rows for (wallet, market) carry
   `redeemed_at`/`redeem_tx_hash`; the claim card is gone (the listing now
   returns no row for that market).
4. **Double-claim** — call `POST /api/markets/redeem/calldata` again for
   the same market: expect 409 `NOTHING_TO_REDEEM` (the tokens were burned).
5. **Market detail** — open the game's detail page with the winning wallet
   connected: the claim card renders above the chart and works identically.
6. **Guards** — a market still OPEN returns 409 `NOT_REDEEMABLE`; a bogus
   `txHash` to `/record` returns 422; a tx targeting anything other than
   that market's contract returns 422 `WRONG_TARGET`.

## Out of scope

- Writing `market_positions` rows in the first place (nothing populates
  them yet; the record endpoint stamps whatever rows exist).
- Agent-initiated redemption (the agent stack can reuse
  `market-redeem.ts`'s helpers when it grows a claim tool).
- Exact payout from receipt logs (the estimate is the quote convention the
  fills path also uses; log decoding can tighten both later).
