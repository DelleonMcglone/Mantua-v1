# Mantua.AI

**Mantua is an agent-native prediction market for sports.** Take a position on a game in plain
language, or hand the whole loop to an autonomous agent. It combines the **Dynamic Market
Hook**, one Uniswap v4 hook that embeds pricing, fees, and circuit breakers directly into
market execution, with **AI agents** running **Circle Developer-Controlled Wallets** and
real-time on-chain settlement, turning user intent into market actions: live in-game markets
and USDC-settled event contracts. Gas is sponsored by Circle, so nobody holds ETH.

From a single natural-language prompt you can:

- **Take a position** on a scheduled game, priced continuously by the market rather than by a
  bookmaker.
- **Analyze and research** matchups, market depth, price movement, and settlement history (free
  data, with optional pay-per-call x402 premium sources).
- **Run an autonomous agent**: a Circle-managed wallet that researches, takes positions, and
  hedges under a spending cap.
- **Give your agent a public record and a voice**: a performance page at `/agents/<handle>`
  derived from its chain-verified trades, and template-based market posts to X under a
  posting policy you approve.
- **Get help**: a read-only support agent that explains markets, your own deposits,
  withdrawals and positions, walks through troubleshooting, and hands off to a person.

> **Status: live at [mantua.ai](https://mantua.ai) on Base Mainnet (8453).** The app (markets,
> agent, portfolio, analytics) runs against Base Mainnet. **Mantua's own contracts (the Dynamic
> Market Hook, the market factory/resolver, and the agent-commerce escrow) are awaiting their
> Base Mainnet deployment**; until they are deployed, hook-gated market pools and on-chain
> market minting stay dark and the app degrades gracefully (addresses are env-driven, `null`
> by default). There is no separate landing page: `/` is the board for every visitor.
> [`docs/tasks/v2-roadmap.md`](docs/tasks/v2-roadmap.md) tracks the build plan and
> [`docs/security/hook-deployments.md`](docs/security/hook-deployments.md) tracks the
> deployment checklist.

## Network

Mantua runs on a single chain: **Base Mainnet**.

| Network          | Chain id | RPC                        | Explorer             |
| ---------------- | -------- | -------------------------- | -------------------- |
| **Base Mainnet** | `8453`   | `https://mainnet.base.org` | https://basescan.org |

RPC overrides: `VITE_BASE_RPC_URL` (client), `BASE_RPC_URL` (server and agent); fallback
`https://base-rpc.publicnode.com`. Every transaction is gas-sponsored: Circle Gas Station
covers the agent wallet and Circle Paymaster covers user transactions, so no wallet ever needs
ETH. Contract addresses live in
[`server/src/lib/v4-contracts.ts`](server/src/lib/v4-contracts.ts) and
[`server/src/lib/markets-contracts.ts`](server/src/lib/markets-contracts.ts); the hook
deployment status is attested in
[`docs/security/hook-deployments.md`](docs/security/hook-deployments.md).

## The problem and who it's for

Prediction markets are static. Odds and depth sit passively while the world moves, so quotes
go stale the moment news breaks and bettors trade against yesterday's price. Mantua makes the
market itself programmable: fees adapt to the state of the game, trading halts under
conditions the market defines in advance, and settlement is enforced on-chain rather than by
a house. **Bettors and the agents acting for them** drive all of it from natural-language
instructions.

## Why it's better

Prediction markets today are passive. Mantua makes them **state-aware, fee-adaptive,
oracle-enforced, and agent-managed** by embedding these behaviors directly into market
execution through the Dynamic Market Hook. By letting AI agents price, take, and manage
positions in response to real-time game conditions, Mantua turns a sports market from a
static book into an automated, verifiable settlement system.

## How a market works

One scheduled game produces one market. Each market mints a **YES/NO ERC-20 pair** fully
collateralised 1:1 by USDC, and the YES token trades against USDC in a Uniswap v4 pool carrying
the Dynamic Market Hook. A YES pays 1 USDC if the outcome happens and 0 if it does not, so its
price **is** the market's implied probability: a YES at 0.62 is a 62% chance.

```
create → seed → trade → freeze → resolve → redeem
                                     └────→ void (postponed / cancelled)
```

- **split**: 1 USDC in, 1 YES + 1 NO out. **merge** reverses it. Both are fee-free, and
  together they are the arbitrage floor that keeps the price inside [0, 1].
- **trade in play**: buy and sell run before **and** during the game.
- **freeze** when the game goes final, plus a permissionless backstop 12 hours after kickoff so
  no market outlives its event even if the service is down. Both are enforced by the hook, so
  they hold even if the interface is bypassed.
- **resolve** from live game data, with provider disagreement flagged for review and a manual
  override so a bad feed cannot auto-settle a market.
- **redeem** the winning token 1:1 for USDC. A voided game returns collateral instead.

Collateral held is always at least the outstanding redeemable supply. That invariant is fuzzed
over half a million calls in `contracts/test/markets/MarketInvariant.t.sol`.

Full specification: [`docs/specs/market-lifecycle.md`](docs/specs/market-lifecycle.md).

## Coverage

**NFL** is the only covered league. The catalog lives in
[`client/src/features/markets/sports.ts`](client/src/features/markets/sports.ts); a league added
there shows up in the nav, the board and the market pages, and the server's covered-league
lists gate ingestion, the slate, the live stream and the agent.

## The autonomous loop

Autonomous agents turn intent into action: **they buy the intelligence they need, then deploy
capital with it.**

1. The agent hits a question it can't answer, so it **searches Circle's x402 marketplace**.
2. **Pays per call in USDC**: capped, audited, no API keys, no accounts.
3. **Combines paid intelligence with live sports and on-chain signals**: game state, market
   depth, price movement, settlement history.
4. **Executes through the Dynamic Market Hook and a Circle Developer-Controlled Wallet**: takes
   a position, sizes it under its cap, and bridges USDC in via CCTP when it needs to fund it.
5. **Manages the position**: hedging strategies fire on price and game-state ticks under a
   policy cap, and auto-disarm when a market freezes.

Programmable money buying programmable intelligence, then acting on it in one autonomous loop.

**Programmable Sports Agents**

---

## App capabilities

- **Universal command bar.** One input routes every command by intent; a card only _starts_ a
  mode, it never locks it. Actions and agent commands go to the Circle Agent; research
  questions open Analyze.
- **Sports markets.** A cross-league **Discover** page (filter by league, team, game, status,
  start time, liquidity, popularity, or just type "What can I trade right now?") and
  full-screen per-league pages: date-grouped games with contract prices fed by the **live
  market price**, each labelled with its source (market price vs. projection), and a **trade
  ticket**: price tap, amount tap, Confirm. Three taps to a position, two to close. The
  ticket shows the hook's exact fee (Position / Fee / Fee rate / Total, 0% in the regular
  season), ends in an explicit **Trade executed** card, offers **Add funds** inline (bank or
  USDC) when the balance is short, and never mentions gas, a network, or an address. Browsing
  and matchup details are open to everyone; anonymous visitors also get **three free analyst
  questions a day** (enforced server-side), after which chat and every transaction require
  login.
- **Automated hedging strategies.** Describe one in plain language ("take profit at 80% on the
  Chiefs"), confirm the structured preview, and it arms: evaluated on price and game-state
  ticks, sized under its own USDC cap, armed straight through the game and auto-disarmed when
  the market closes. Kill switches at every level; every transition audited.
- **Prediction market combos.** Build a parlay-style ticket across two or more games (up to a
  configured leg cap) and buy it as one position: a combo is a full-collateral conjunction
  market minted through the same factory as a single game, priced at the product of its legs'
  fair probabilities, settled YES only if every leg wins (any loss means NO; a void leg drops
  out). One transaction, one confirmation, one position, not a bundle of separate bets.
- **Mobile, installable.** Below `lg` the trade ticket is a bottom sheet reachable from a price
  tap, a Discover tap, or a push notification; a live-glance card tracks each in-progress game
  (score, both prices, held-side P&L, Sell / Lock in); Web Push covers trades, positions, games,
  agent actions and settlement; and the app installs from the browser as a PWA with its own
  manifest, icons and offline-capable shell.
- **State-aware market execution.** The Dynamic Market Hook embeds pricing, fee logic, risk
  caps, and circuit breakers directly into the market pool: 0% fees in the regular season, a
  bounded dynamic rate in the playoffs, per-risk trade caps, and a freeze that fires on the
  event's final state with a keeper-independent backstop (see
  [The Dynamic Market Hook](#the-dynamic-market-hook)).
- **Analyze and research.** Inline conversational research: deterministic cited data cards for
  known topics plus AI-streamed answers for free-form questions.
- **Portfolio and activity.** User and agent portfolios: open positions, realised and
  unrealised P&L, settlement history, and one unified activity timeline across every money
  path.

## Agent capabilities (your Circle Agent)

A research analyst and market operator running a tool-using Claude loop over a
server-custodied Circle wallet on Base Mainnet, gas-sponsored by Circle Gas Station and bounded
by a daily USD spending cap. Reads run as the conversation goes; anything that moves money is
previewed in the chat and executed only after you reply "confirm". The server mints a
single-use confirmation id from your own message and re-simulates a market trade right before
it runs (`AGENT_MODE`). x402 paid data is the agent's own pre-capped spend and needs no
confirmation.

- **Wallet**: auto-provisioned; view/manage, set the daily cap, and fund it by transferring
  USDC from your own wallet.
- **Positions**: take and close YES/NO positions and combos on covered games, every one
  cap-checked, simulated immediately before execution, and recorded to the activity spine.
- **Move funds**: send USDC from the agent wallet.
- **On-chain analysis (BaseScan).** Inspect any Base address (balance, activity, whale
  signals: accumulating/selling, stables-to-tokens rotation), any token (holders, top-10
  concentration, safety red flags), and any transaction (decoded token movements).
- **Analyst workflow.** "Give me my daily briefing" runs market pulse, then portfolio review,
  then on-chain highlights, figures first. It never blindly copies a wallet; it verifies
  hypotheses against live data.
- **Analyst advisor.** If the agent can't afford a position (balance or cap), it reads _your_
  wallet and, if you hold enough, delivers its analysis with a concrete "execute this
  yourself" recommendation.
- **Public track record and voice.** Claim a handle and the agent gets a public performance
  page derived from its chain-verified trades (realised/unrealised P&L, ROI, drawdown,
  exposure, risk, every market including the losses, labelled by execution mode) that nobody
  can edit; and, under a posting policy you approve template by template, it posts market
  updates, explain-the-move analysis and price-as-signal forecasts through the platform's X
  account, every post linted for compliance-safe wording.
- **Support desk.** A read-only support agent, signed in or not: how markets work, your own
  deposits, withdrawals, positions and transactions, deterministic troubleshooting, and a
  ticket to a person when it cannot resolve the problem.
- **x402 agent marketplace (buyer).** Access to Circle's full paid-services catalog
  ([agents.circle.com/services](https://agents.circle.com/services)): web search, news,
  weather, sports, prediction markets, social lookups, papers, SMS/communication APIs, paid
  per-call in USDC (pre-capped, daily-capped, audited); the agent searches the marketplace
  before declining a request. HTTP-native x402 v2 buyer works in prod, no CLI
  ([setup](docs/x402-setup.md)).
- **x402 agent marketplace (seller).** Mantua also sells: six machine-readable services for
  external agents (market discovery, market intelligence, market trading quote and calldata,
  portfolio exposure, hedging plans, and an allowlisted sports-intelligence pilot) at
  `/api/x402/v1/*`, priced from one catalog
  ([`server/src/lib/x402/catalog.ts`](server/src/lib/x402/catalog.ts)) and dark by default
  behind `X402_SELLER_ADDRESS` / `X402_SELLER_SERVICES`, plus the legacy `GET
/api/x402/analyst-brief` ($0.01) as the first-generation surface. Listing on Circle's
  Marketplace and flipping the seller env on are human steps gated on counsel sign-off; see
  [`docs/marketplace/offerings.md`](docs/marketplace/offerings.md) and
  [`docs/marketplace/become-a-seller.md`](docs/marketplace/become-a-seller.md).

## Institutional custody

An institution is a segregated Circle wallet set, not a new money path. Members sign in with
Privy like anyone else; every member's agent wallet is created inside the institution's own
Circle wallet set (`provisionInstitutionWalletSet`, distinct from the retail wallet set), so
Circle's per-set Gas Station policy, screening, and reported balances scope to the institution
alone. Enforced at the three places money already passes:

- **Spend**: `checkSpendingCap` adds institution-wide per-trade and daily caps (summed across
  every member wallet) on top of the per-wallet cap, gated to members whose role may trade.
- **Send**: the agent's send path admits an institutional wallet only as the execution of an
  approved custody withdrawal, to its verified destination, for exactly that amount.
- **Wallet creation**: an institution without a provisioned wallet set refuses to create
  member wallets rather than silently falling back to the retail set.

**Dual control:** a destination is verified by someone other than whoever added it; a
withdrawal is approved by someone other than whoever requested it (auto-approved only below a
configurable threshold). Roles: owner, admin, trader, approver, viewer. Period statements and
Circle-vs-chain reconciliation are available as JSON or CSV. The institution's custody-grade
_principal_ stays with its own qualified custodian (Anchorage, BitGo, Coinbase Prime,
Fireblocks, Copper, and others): recorded, never integrated. Full spec:
[`docs/tasks/074-institutional-custody.md`](docs/tasks/074-institutional-custody.md).

---

## Built with

### Uniswap v4

- **The Dynamic Market Hook**: Mantua's one hook, deployed at a mined CREATE2 address, carried
  by every market's YES/USDC pool. Base Mainnet deployment is pending (address env-driven,
  `null` until deployed). Source: [`contracts/src/hooks/dynamic-market/`](contracts/src/hooks/dynamic-market).
- **v4 periphery**: the canonical Base Mainnet stack (PoolManager, PositionManager,
  StateView, V4Quoter) plus the market pool's own periphery (its swap and liquidity routers,
  lens, and quoter), recorded per chain in `markets-contracts.ts`.
- Prices read through **StateView**; quotes through **V4Quoter**; all addresses live in
  [`server/src/lib/v4-contracts.ts`](server/src/lib/v4-contracts.ts) and
  [`server/src/lib/markets-contracts.ts`](server/src/lib/markets-contracts.ts).

### Circle

- **Developer-Controlled Wallets** (`@circle-fin/developer-controlled-wallets`): server-managed
  agent wallets (smart-contract accounts) that sign and execute on Base Mainnet; the user's
  signing key is never touched by the agent path.
- **Gas Station and Paymaster**: every agent transaction is sponsored by Circle Gas Station and
  user transactions by Circle Paymaster, so no wallet on the platform holds ETH.
- **x402 agent marketplace** (`@x402/fetch` plus `@x402/extensions` Bazaar discovery): the full
  paid-services catalog at [agents.circle.com/services](https://agents.circle.com/services),
  paid per-call in USDC via EIP-3009 authorizations from the agent's buyer EOA. Mantua is also
  a **seller**: six machine-readable services (market discovery, market intelligence, market
  trading quote/calldata, portfolio exposure, hedging plans, sports intelligence) through a
  dual-rail paywall (Gateway nanopayments plus vanilla exact), plus the legacy `GET
/api/x402/analyst-brief` ($0.01); dark by default, go-live counsel-gated.
- **USDC**: Circle's stablecoin, native on Base Mainnet, the collateral behind every market and
  the unit every balance and payout is quoted in.

### Base

- **Base Mainnet** (chain id `8453`): Coinbase's Ethereum L2. RPC
  `https://mainnet.base.org` (fallback `https://base-rpc.publicnode.com`); explorer
  [BaseScan](https://basescan.org).
- **BaseScan API** powers the agent's on-chain analysis tools (address activity,
  token holders, transaction decoding).

### Pyth Network

- **Hermes price feeds**: the price source behind `getUsdPrice` for portfolio and balance
  valuation, with DefiLlama as automatic fallback.

### Application

- **Client**: Vite + React + TypeScript SPA; Privy auth (embedded and external wallets), viem,
  lightweight-charts.
- **Server**: Express + TypeScript API; Anthropic **Claude** (`claude-opus-4-8`) agent loop,
  Drizzle ORM + Postgres (Neon). Deployed on **Vercel** (serverless) with crons: sports-sync
  (ingest plus on-chain market/pool creation), resolution (settlement), strategies (hedging
  ticks), and social posts. Game-day cadence comes from pointing any external scheduler at the
  same cron URLs.

---

## The Dynamic Market Hook

Mantua ships **one** Uniswap v4 hook. Every market's YES/USDC pool is created with it, so the
market's rules travel with the pool rather than living in the interface: fees, risk caps, and
the trading freeze all hold even if the app is bypassed. Its eight Solidity modules live in
this repo under
[`contracts/src/hooks/dynamic-market/`](contracts/src/hooks/dynamic-market), alongside the
market primitives in [`contracts/src/markets/`](contracts/src/markets) and the Foundry deploy
scripts in [`contracts/script/`](contracts/script). Base Mainnet deployment is pending.

> The hook shipped against the authoritative spec in
> [`docs/specs/dynamic-market-hook.md`](docs/specs/dynamic-market-hook.md) and the Mantua fee
> model (user page [`docs/fee-model.md`](docs/fee-model.md)): **0% fees in the regular season;
> in the playoffs a dynamic 0.10% to 0.70% rate** (liquidity, volatility, trading activity,
> market uncertainty; the 0.70% ceiling is an immutable constant) applied as
> `Fee = C × rate × p × (1 − p)`, so 50/50 contracts pay the most and near-certain ones almost
> nothing. Plus per-risk trade caps, in-play trading that halts on the event's `FINAL` state
> with a keeper-independent 12-hour backstop that fires even with no keeper write, and
> fail-closed behaviour on stale keeper state. Security review:
> [`docs/security/dynamic-market-fee-review.md`](docs/security/dynamic-market-fee-review.md);
> the ship gate ([`docs/security/sign-off.md`](docs/security/sign-off.md)) awaits re-signing
> for the fee model.

Hook permission bits and PoolManager wiring are verified by `npm run verify:hooks`, attested in
[`docs/security/hook-deployments.md`](docs/security/hook-deployments.md).

---

## Deployed contracts

The single supported chain is **Base Mainnet `8453`** (verifiable on
[BaseScan](https://basescan.org)). The canonical machine-readable source is
[`server/src/lib/v4-contracts.ts`](server/src/lib/v4-contracts.ts) and
[`server/src/lib/markets-contracts.ts`](server/src/lib/markets-contracts.ts).

### Uniswap v4 (canonical Base Mainnet deployment)

| Contract        | Address                                      |
| --------------- | -------------------------------------------- |
| PoolManager     | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| PositionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` |
| StateView       | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` |
| V4Quoter        | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |

### Mantua contracts: Base Mainnet deployment pending

Mantua's own contracts (DynamicMarketHook, MarketStateRegistry, MarketFactory, Resolver, and
the AgenticCommerce (ERC-8183) escrow) have **no mainnet addresses yet**. They are configured
through env overrides, default to `null`, and the app degrades gracefully until they are
deployed. The deployment and verification checklist lives in
[`docs/security/hook-deployments.md`](docs/security/hook-deployments.md); the step-by-step
runbook and the deployment record live in
[`deploy/dynamic-market/README.md`](deploy/dynamic-market/README.md).

Once deployed: each game's Market contract and YES/NO tokens are minted by the factory at
ingest time, with deterministic ids and one market per side per game. The Resolver is the
fixed settlement authority every market burns in as an immutable; the keys behind it rotate
without redeploying a single market.

---

## Architecture

```
client/      Vite + React + TypeScript SPA (port 5173): the home board, docs, legal, market
             pages, the combo builder, the agent panel, the public agent page
             (/agents/<handle>), voice settings, and the support panel
server/      Express + TypeScript API (port 3001): market calldata builders, quotes, agent,
             portfolio, market id + probability utils, the derived performance ledger
             (lib/agent), social posting (lib/social), the support agent (lib/support),
             custody (lib/custody), the x402 seller catalog (lib/x402), Drizzle schema
contracts/   Foundry contracts: market primitives (MarketFactory, Market, OutcomeToken,
             Resolver, pool bootstrap), the Dynamic Market Hook (8 modules), full-lifecycle
             E2E tests, and the deploy scripts (contracts/script/)
deploy/      Deploy runbooks, the deploy wrapper, and per-chain deployment records for the
             market stack and the agent-commerce escrow
docs/        Architecture, specs, decision memos, task lists, legal drafts
```

- **Wallets.** Users connect via Privy (embedded and external). Agents use **Circle
  Developer-Controlled Wallets** (server-managed smart-contract accounts on Base); the user's
  signing key is never touched by the agent path.
- **Market pools.** Every market pool resolves to the canonical Base Mainnet v4 stack plus the
  market periphery the factory bootstraps; the pool's hook is always the Dynamic Market Hook.

---

## Documentation

| Document                                                                                       | What it covers                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)                                                 | Living architecture notes and the decision log                         |
| [`docs/tasks/v2-roadmap.md`](docs/tasks/v2-roadmap.md)                                         | The build plan and what is done                                        |
| [`docs/decisions/v2-open-decisions.md`](docs/decisions/v2-open-decisions.md)                   | Every design decision, its reasoning, and what it rules out            |
| [`docs/specs/market-lifecycle.md`](docs/specs/market-lifecycle.md)                             | Market states, transitions, failure modes                              |
| [`docs/specs/market-id.md`](docs/specs/market-id.md)                                           | Deterministic market ids                                               |
| [`docs/specs/dynamic-market-hook.md`](docs/specs/dynamic-market-hook.md)                       | The authoritative hook spec (§1 to §46) plus implementation record     |
| [`docs/fee-model.md`](docs/fee-model.md)                                                       | The fee model in user terms                                            |
| [`docs/security/sign-off.md`](docs/security/sign-off.md)                                       | Ship-gate security sign-off: findings, rails, E2E proofs               |
| [`docs/security/hook-deployments.md`](docs/security/hook-deployments.md)                       | Hook deployment status and verification                                |
| [`deploy/dynamic-market/README.md`](deploy/dynamic-market/README.md)                           | The Dynamic Market Hook deploy runbook and deployment record           |
| [`docs/ops/incident-runbook.md`](docs/ops/incident-runbook.md)                                 | Kill switches, mis-resolution, provider failover, comms                |
| [`docs/ops/monitoring.md`](docs/ops/monitoring.md)                                             | Latency budgets, metrics reads, the alert/paging policy                |
| [`docs/tasks/live-sports-reliability.md`](docs/tasks/live-sports-reliability.md)               | Real-time stream, status ladder, trade state, load/chaos               |
| [`docs/tasks/070-agent-extended.md`](docs/tasks/070-agent-extended.md)                         | The performance ledger, social posting, AI support                     |
| [`docs/tasks/071-mobile-experience.md`](docs/tasks/071-mobile-experience.md)                   | The phone: sheet ticket, live glance, push, PWA, budgets               |
| [`docs/tasks/072-prediction-market-combos.md`](docs/tasks/072-prediction-market-combos.md)     | Combos as conjunction markets                                          |
| [`docs/tasks/073-phase-17-agent-marketplace.md`](docs/tasks/073-phase-17-agent-marketplace.md) | The x402 seller catalog, dual-rail paywall, marketplace packaging      |
| [`docs/marketplace/offerings.md`](docs/marketplace/offerings.md)                               | The six x402 seller services: endpoint, price, auth, OpenAPI spec URL  |
| [`docs/marketplace/become-a-seller.md`](docs/marketplace/become-a-seller.md)                   | Circle Marketplace seller runbook: prerequisites, intake form, go-live |
| [`docs/tasks/074-institutional-custody.md`](docs/tasks/074-institutional-custody.md)           | Segregated wallet sets, dual control, statements, reconciliation       |
| [`docs/tasks/075-home-page-restructure.md`](docs/tasks/075-home-page-restructure.md)           | Why there is no landing page, and where its content went               |

An in-app documentation site covering the same ground for users is reachable from the home
page's footer.

---

## Local development

```bash
npm install
# server (port 3001) + client (port 5173)
npm run dev
```

Requires Postgres and a `.env` (see `server/.env.example`, `client/.env.example`). Verify with:

```bash
npm run typecheck            # all workspaces
npm run lint                 # eslint, zero warnings tolerated
npm test -w @mantua/server   # node:test via tsx; needs a .env for the chain/provider suites
npm test -w @mantua/client   # node:test via tsx over the pure *-core modules
npm run e2e                  # browser suite: the real client in Chromium, auth shimmed, API + chain scripted
npm run e2e:mobile -w @mantua/client   # mobile suite: 360×740 + 430×932, touch, mobile UA
```

**Market depth.** The market page's deeper layer (depth ladder, live game, research, fees and
execution, past markets) is served by `GET /api/markets/depth`, `/analysis`, and `/history`
and proven by `client/e2e/market.spec.ts`.

**Voice input.** A hold-to-speak microphone in the command bar produces text and hands it to
the same submit the Send button uses, so a spoken command takes the pipeline a typed one
takes. `ELEVENLABS_API_KEY` stays server-side: `POST /api/voice/token` spends it on a
single-use token the browser opens the transcription socket with. Set no key and the
microphone is simply not offered. Speech can ask for anything but can never confirm a trade:
the server refuses to mint a confirmation from a spoken turn, so Confirm stays a press
(`client/e2e/voice.spec.ts`).

**Public record, posting, support.** `GET /api/agents/<handle>` serves the canonical
performance ledger, derived on read from chain-verified fills, market resolutions and the
audit trail and never stored, with realised and unrealised P&L, ROI, drawdown, exposure, a
risk block, every market including the losses, a breakdown by execution mode (simulated /
user-confirmed / autonomous), and a digest over all entries; the fills table refuses UPDATE
and DELETE at the database. The app answers `/agents/<handle>` as a public page. A user
claims the handle and a posting policy at `PATCH /api/agent/social`; the fifteen-minute
`GET /api/cron/social-posts` tick composes market updates, explain-the-move and
price-as-signal posts from templates over live data, passes each through a compliance lint
and the user's cadence gate, and sends through the deployment's X account (`X_API_KEY`,
`X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`; absent means recorded dry runs).
`POST /api/support/chat` (SSE) and `POST /api/support/message` (JSON) run a read-only support
agent with a knowledge base, the caller's own account context, deterministic troubleshooting
flows and a human-escalation ticket.

**Browser suite.** `client/e2e/` needs no Privy app id, database, or chain: it starts Vite
with `VITE_E2E_AUTH=shim` and answers the API and the RPC from Playwright routes. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a preinstalled Chromium.

**Mobile.** The desktop code runs at two breakpoints (`client/src/lib/mobile.ts`): below `lg`
the trade ticket becomes a bottom sheet, below `md` the header nav moves behind a hamburger.
Web Push (`server/src/lib/push/`) runs on `node:crypto` alone (RFC 8291/8292, no external
push library) across five topics (trades, positions, games, agent, settlement), dark unless
its three VAPID env vars are set. The install prompt, manifest and service worker live under
`client/src/features/pwa/`. `client/playwright.mobile.config.ts` runs `client/e2e/mobile/` at
360×740 and 430×932 against a production build so the mobile budgets in
`client/src/lib/mobile-budgets.ts` are enforced for real.

**Combos.** A combo is a full-collateral conjunction market minted through the existing
factory, priced at the product of its legs' fair probabilities, and settled YES only if every
leg wins. `POST /api/combos/prepare`, `/quote`, and `/calldata` create, price, and execute it
in a single transaction; `combo-rules.ts` and the user's `combo` policy block gate what can
be combined.

**x402 seller.** Six machine-readable services under `/api/x402/v1/*` (market discovery,
market intelligence, market trading quote/calldata, portfolio exposure, hedging plans, sports
intelligence), priced from one catalog and served through a dual-rail paywall (Circle Gateway
nanopayments plus vanilla x402 `exact`, both in one 402 response). Each service publishes its
own unpaid OpenAPI 3.1 document at `GET /api/x402/openapi/:serviceId.json` (index:
`/api/x402/openapi.json`), kept honest by a catalog-to-spec parity test. Dark by default
behind `X402_SELLER_ADDRESS` / `X402_SELLER_SERVICES`; listing on Circle's Marketplace and
flipping the env on are human steps gated on counsel sign-off; see
[`docs/marketplace/become-a-seller.md`](docs/marketplace/become-a-seller.md).

**Institutional custody.** An institution is a segregated Circle wallet set: members' agent
wallets are created inside it, institution-wide caps sit on top of the per-wallet cap,
withdrawals go only to verified custodian addresses under dual control, and period statements
plus Circle-vs-chain reconciliation are available as JSON or CSV. Operator surface:
`/api/ops/institutions` behind `requireOpsAuth` (`MANTUA_OPS_KEY`).

**Home page.** `/` resolves directly to the board (the `home` route) for every visitor,
logged in or not; the Documentation link, social channels, and legal links live in a footer
on the home page itself (`client/src/components/shell/Footer.tsx`).

### Contracts

```bash
cd contracts
forge test    # market primitives, the Dynamic Market Hook suite, invariants, full-lifecycle E2E
```

> **Dependencies are not vendored.** `contracts/lib/` is gitignored, so a fresh checkout has no
> forge-std, solmate, OpenZeppelin, v4-core, or v4-periphery and the Solidity will not compile
> until they are installed. They are not yet pinned as submodules; install them into
> `contracts/lib/` before building (the exact clone commands are in
> [`deploy/dynamic-market/README.md`](deploy/dynamic-market/README.md)).

Optional: the agent can pay per-call for premium data via the x402
marketplace (off by default; set `X402_ENABLED=1` and fund the buyer wallet);
see [`docs/x402-setup.md`](docs/x402-setup.md).

## Deploying the on-chain stack

The Dynamic Market Hook stack (a dedicated PoolManager, the MarketStateRegistry, and the hook
at its mined CREATE2 address) deploys to Base Mainnet with
`deploy/dynamic-market/deploy.sh hook`, followed by `deploy.sh periphery` against the
PoolManager the first step printed. The wrapper checks the chain id, prints the deployer
address and balance, runs the salt-mine and hook suites, shows the fork dry run with the gas
estimate, and only broadcasts after an explicit `yes`. The deployer key lives in an encrypted
Foundry keystore (`cast wallet import mantua-deployer --interactive`), never in an environment
variable. Full procedure, prerequisites, and the post-deploy steps (register the market, then
initialise the pool with the dynamic-fee flag) are in
[`deploy/dynamic-market/README.md`](deploy/dynamic-market/README.md); every `forge script`
run uses `--via-ir --optimizer-runs 200`, the project defaults.
