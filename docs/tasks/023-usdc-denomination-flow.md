# 023 — USDC denomination audit + Deposit→Trade→Withdraw flow (C-004, C-011)

**Status:** ✅ audited and documented, guard shipped, gaps named
**Branch:** `023-usdc-denomination-flow`

Closes the two Phase-1 feature rows the C-wave ledger deferred
(`docs/tasks/circle-custody-wave.md`): **C-004** (USDC as the platform
currency) and **C-011** (Deposit → Trade → Withdraw as the only mental
model). This is an audit-first task: verify every money surface is
denominated in Base-mainnet canonical USDC
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), fix real denomination bugs
in owned files, and name — not build — whatever is missing from the flow.

## C-004 — denomination audit

| Surface | Where | Denomination | Verdict |
| --- | --- | --- | --- |
| Market collateral | `server/src/lib/markets-contracts.ts` (`MarketsDeployment.collateral`) | Per-chain deployment config; Base deployment pending, so `MARKETS_BY_CHAIN` is empty today | ✅ with guard — nothing in code pinned collateral to canonical USDC; now enforced (see Fixes) |
| YES/NO outcome tokens | Market contracts via `MARKET_SPLIT_ABI` / `MARKET_ABI`; conventions in `server/src/lib/sports/strategy-execute.ts`, `client/src/features/markets/LeaguePage.tsx` | 6dp, minted 1:1 from USDC (`split`), winning YES redeems 1 USDC, void settles 0.50 | ✅ USDC-backed |
| Market trades (user + agent + strategy) | `server/src/lib/sports/market-trade-build.ts` (single builder for all three callers) | Exact-input USDC raw 6dp on buys; YES raw 6dp on sells, quoted back to USDC | ✅ |
| Market seeding | `MARKET_SEED_USDC` (`server/src/env.ts`), seed/reband/reclaim in `server/src/lib/sports/markets-onchain.ts` | USDC raw 6dp (default 10 USDC/market; reband capped 50 USDC/market) | ✅ |
| Trading fees | v4 dynamic fee (pips) set by the hooks; split estimate in `server/src/lib/hook-fee-split.ts` | Ratio of trade size, accrued in the pool's currencies — for market pools that is USDC + YES (itself USDC-redeemable) | ✅ |
| Fee config | `MANTUA_FEE_BPS` / `MANTUA_FEE_RECIPIENT` / `MANTUA_FEE_ADMIN_KEY` (`server/src/env.ts`), `DEFAULT_FEE_BPS`/`MAX_FEE_BPS` (`server/src/lib/constants.ts`) | Basis points (denomination-agnostic ratio) + recipient address | ✅ — note: validated at boot but no server-side runtime consumer yet (fee collection lives in the hook contracts) |
| Spending caps | `server/src/lib/spending-cap.ts`, `dailyCapUsd` / `capUsd` / `maxStakePerTradeUsd` columns | USD, with USDC ≡ $1 by convention: market buys charge the exact USDC amount (`marketTradeSpendUsd`), strategy closes bound by token count (`closeLegUsd`, YES ≤ 1 USDC); other tokens priced by strict feeds that fail closed | ✅ sanctioned USD≈USDC convention |
| Positions + portfolio display | `server/src/routes/market-positions.ts` (`valueRaw`, `pnlRaw` in USDC raw 6dp), `client/src/features/portfolio/MarketPositionsSection.tsx` (renders "≈ x USDC") | USDC raw 6dp | ✅ |
| Bets/fills schema | `server/src/db/schema/markets.ts` — `combos.stakeRaw`, `combos.potentialPayoutRaw`, `market_fills.usdcRaw` | USDC raw 6dp (documented on the columns) | ✅ |
| Unified balance (Gateway) | `server/src/routes/agent-unified-balance.ts` | USDC only (Gateway is USDC-native) | ✅ |
| x402 nanopayments | `X402_MAX_PER_CALL` / daily ceiling (`server/src/env.ts`) | USDC | ✅ |
| Gas | User-signed approve+swap (Privy wallet) and the treasury market signer | **ETH** | ⚠️ the one legitimate exception — being removed by the gasless task (C-005/C-006 wave); agent-side Circle executions are already gas-sponsored. Not fixed here by design. |
| Swap/LP token registry | `server/src/lib/tokens.ts` (EURC, cbBTC alongside USDC) | Other assets | ✅ out of scope — these are tradeable assets in the swap/LP module, not a unit of account; caps value them via strict USD feeds |

### Fixes made

- **Canonical-USDC collateral guard** — nothing previously asserted that a
  markets deployment's `collateral` is the chain's canonical USDC; a
  misconfigured deployment would have silently misdenominated trades,
  cap accounting (which treats USDC input as USD), and settlement.
  Added `assertUsdcCollateral` in
  `server/src/lib/sports/market-trade-build.ts`, called from the two choke
  points every market money-leg passes through: `buildMarketTrade` (user
  route, agent tool, strategy executor) and `marketsCfg` in
  `server/src/lib/sports/markets-onchain.ts` (seed, reclaim, reband,
  resolution submitter). Unit tests in
  `server/src/lib/sports/market-trade-build.test.ts`.

### Out-of-scope findings (not fixed here — owners elsewhere)

- `MANTUA_FEE_BPS`/`MANTUA_FEE_RECIPIENT` have no runtime consumer in the
  server; when fee collection is wired up, the recipient sweep must land in
  USDC (or USDC-redeemable pool tokens) to keep C-004 true.
- `MARKETS_BY_CHAIN` is empty until the Base deployment lands
  (`docs/tasks/v2-roadmap.md`); the new guard makes the collateral binding
  self-checking at that moment.

## C-011 — Deposit → Trade → Withdraw flow trace

| Leg | Route / component | Status |
| --- | --- | --- |
| Deposit: external → user wallet | Wallet address shown on `client/src/features/portfolio/ProfilePage.tsx`; user sends USDC to it (exchange withdrawal or another wallet) | ⚠️ exists but bare — see GAP-1 |
| Deposit: user → agent wallet | Agent chat funding guidance (`server/src/lib/agent-chat.ts` system prompt) hands out the agent address; Agent panel shows it with a copy affordance (`client/src/features/agent/agent-primitives.tsx` `CopyButton`); `AssetsCard` agent tab shows it shortened | ⚠️ manual transfer only — see GAP-2 |
| Trade: user buy/sell | `client/src/features/markets/LeaguePage.tsx` trade sidebar → `use-market-trade.ts` → `POST /api/markets/trade/calldata` (`server/src/routes/market-trade.ts`) → `buildMarketTrade`; user's wallet signs approve + swap | ✅ end-to-end |
| Trade: agent buy/sell | `trade_market` chat tool (`server/src/lib/agent-chat.ts`) and strategy closes → `agentMarketTrade` (`server/src/lib/sports/market-agent-trade.ts`) → same builder; Circle DCW signs, gas-sponsored, cap-checked | ✅ end-to-end |
| Exit: sell before kickoff | Same trade path, `direction: "sell"` — YES back to USDC | ✅ |
| Exit: redeem after resolution | Contract `redeem()` pays 1 USDC per winning YES; treasury reclaims its own tokens (`reclaimSettledMarkets`, `server/src/lib/sports/markets-onchain.ts`) | ❌ no user path — see GAP-3 |
| Withdraw: agent → user / any address | Chat `send` tool or `POST /api/agent/send` (`server/src/routes/agent-send.ts` → `server/src/lib/agent-send.ts`): ERC-20 USDC transfer, cap-checked, receipt-confirmed, gas-sponsored. Cross-chain: `POST /api/agent/unified-balance/spend` and the bridge tool | ✅ end-to-end |
| Withdraw: user wallet → external | — | ❌ no in-app path — see GAP-4 |

### Named gaps (documented, not built — UI work is out of this task's scope)

- **GAP-1 — no deposit affordance for the user wallet.** The profile page
  prints the address as plain text: no copy button, no QR, no on-ramp
  entry point, and no "network: Base" warning at the point of copy (the
  agent chat gives that warning; the profile page does not).
- **GAP-2 — user→agent funding is instructional, not transactional.** The
  user is told to send USDC to the agent address; the client never builds a
  user-signed transfer to it. (Partly by design: per D-008 the agent path
  never touches the user's Privy key — but a *user-signed* one-click
  transfer would not cross that boundary.)
- **GAP-3 — no user redemption of winning positions.** After resolution a
  winning YES redeems for 1 USDC only via a raw `Market.redeem()` call.
  There is no route that builds redeem calldata and no portfolio button, so
  the Trade → Withdraw arc dead-ends for winners who hold to resolution
  (positions held by the *agent* can be exited pre-kickoff by the agent,
  but redemption post-resolution has no tool either).
- **GAP-4 — no user-wallet withdrawal.** The client signs trades and LP
  operations only; there is no send/withdraw flow from the user's own
  wallet. Funds in the user wallet leave only via trading or via Privy's
  own wallet UI outside the app.

The user-facing mental model is documented in `docs/architecture.md` under
"Deposit → Trade → Withdraw (C-011)".

## Gates

`npm run typecheck`, `npm run lint`, `npm test -w @mantua/server` — all
clean at commit time.
