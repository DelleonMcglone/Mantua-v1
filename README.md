# Mantua.AI

**Mantua is an agent-native prediction market for sports.** Take a position on a game in plain
language, or hand the whole loop to an autonomous agent. It combines the **Dynamic Market
Hook** — one Uniswap v4 hook that embeds pricing, fees, and circuit breakers directly into
market execution — with **AI agents** running **Circle Developer-Controlled Wallets** and
real-time on-chain settlement, turning user intent into market actions: live in-game markets
and USDC-settled event contracts.

From a single natural-language prompt you can:

- **Take a position** on a scheduled game, priced continuously by the market rather than by a
  bookmaker.
- **Analyze & research** matchups, market depth, price movement, and settlement history (free
  data, with optional pay-per-call x402 premium sources).
- **Run an autonomous agent** a Circle-managed wallet that researches, takes positions, and
  hedges under a spending cap.
- **Give your agent a public record and a voice** a performance page at `/agents/<handle>`
  derived from its chain-verified trades, and template-based market posts to X under a
  posting policy you approve.
- **Get help** a read-only support agent that explains markets, your own deposits,
  withdrawals and positions, walks through troubleshooting, and hands off to a person.

> **Status: live at [mantua.ai](https://mantua.ai) on Base Mainnet (8453).** The app —
> markets, agent, portfolio, analytics — runs against Base Mainnet. **Mantua's own contracts
> (the Dynamic Market Hook, the market factory/resolver, and the agent-commerce escrow) are
> awaiting their Base Mainnet deployment**; until they are deployed, hook-gated market pools
> and on-chain market minting stay dark and the app degrades gracefully (addresses are
> env-driven, `null` by default). [`docs/tasks/v2-roadmap.md`](docs/tasks/v2-roadmap.md)
> tracks the build plan — Phases 0–13, 15, 16, 18 and 19 are shipped (market protocol,
> trading UX, live-sports reliability, the agent core, portfolio and activity, the launch
> gate, market depth, voice, the agent's public ledger/social posting/AI support, the mobile
> experience, prediction-market combos, and institutional custody); **`/` is the app's one
> front door** — there is no standalone landing page, so every visitor lands on the board
> (Phase 19, D-121). Phase 17 (the Circle Agent Marketplace) is code-complete — six
> machine-readable services sold per-call in USDC — with go-live gated on counsel sign-off
> (D-012); Phase 14 (Base Builder Code) is next.
> [`docs/security/hook-deployments.md`](docs/security/hook-deployments.md) tracks the
> deployment checklist.

## Network

Mantua runs on a single chain: **Base Mainnet**.

| Network          | Chain id | Gas token | What runs there                                                                                                |
| ---------------- | -------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| **Base Mainnet** | `8453`   | ETH       | Sports markets (Dynamic Market Hook + factory/resolver, deployment pending), USDC settlement, the agent wallet |

The user wallet, the market pools, and the Circle agent wallet all target Base Mainnet.
Contract addresses live in
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
price **is** the market's implied probability a YES at 0.62 is a 62% chance.

```
create → seed → trade → freeze → resolve → redeem
                                     └────→ void (postponed / cancelled)
```

- **split** 1 USDC in → 1 YES + 1 NO out. **merge** reverses it. Both are fee-free, and
  together they are the arbitrage floor that keeps the price inside [0, 1].
- **trade in play** buy and sell run before **and** during the game (D-103).
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

**NFL** and **WNBA** are the covered leagues. NBA, MLB, NHL, and Soccer appear in the nav and
report as coming soon; promoting one is a single field in
[`client/src/features/markets/sports.ts`](client/src/features/markets/sports.ts).

## The autonomous loop

Autonomous agents turn intent into action: **they buy the intelligence they need, then deploy
capital with it.**

1. The agent hits a question it can't answer → **searches Circle's x402 marketplace**.
2. **Pays per call in USDC** capped, audited, no API keys, no accounts.
3. **Combines paid intelligence with live sports and on-chain signals** game state, market
   depth, price movement, settlement history.
4. **Executes through the Dynamic Market Hook + a Circle Developer-Controlled Wallet** take a
   position, size it under its cap, bridge USDC via CCTP to fund it.
5. **Manages the position** hedging strategies fire on price and game-state ticks under a
   policy cap, and auto-disarm when a market freezes.

Programmable money buying programmable intelligence, then acting on it in one autonomous loop.

**Programmable Sports Agents**

---

## App capabilities

- **Universal command bar.** One input routes every command by intent a card only _starts_ a
  mode, it never locks it. Actions and agent commands go to the Circle Agent; research
  questions open Analyze.
- **Sports markets.** A cross-league **Discover** page (filter by league, team, game, status,
  start time, liquidity, popularity — or just type "What can I trade right now?") and
  full-screen per-league pages: date-grouped games with contract prices fed by the **live
  market price**, each labelled with its source (market price vs. projection), and a **trade
  ticket** — price tap, amount tap, Confirm: three taps to a position, two to close. The
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
  fair probabilities, settled YES only if every leg wins (any loss → NO; a void leg drops
  out). One transaction, one confirmation, one position — not a bundle of separate bets
  (D-119).
- **Mobile, installable.** Below `lg` the trade ticket is a bottom sheet reachable from a price
  tap, a Discover tap, or a push notification; a live-glance card tracks each in-progress game
  (score, both prices, held-side P&L, Sell / Lock in); Web Push covers trades, positions, games,
  agent actions and settlement; and the app installs from the browser as a PWA with its own
  manifest, icons and offline-capable shell (Phase 15, D-118).
- **State-aware market execution.** The Dynamic Market Hook embeds pricing, fee logic, risk
  caps, and circuit breakers directly into the market pool: 0% fees in the regular season, a
  bounded dynamic rate in the playoffs, per-risk trade caps, and a freeze that fires on the
  event's final state with a keeper-independent backstop (see
  [The Dynamic Market Hook](#the-dynamic-market-hook)).
- **Funding.** Add funds by bank or USDC transfer; bridge USDC in from the CCTP-V2 mainnet
  chains Ethereum, Arbitrum One, OP Mainnet, Polygon, Avalanche via Circle CCTP (Bridge Kit),
  with Base as the home chain.
- **Unified balance / treasury.** A single multi-chain USDC balance via Circle Gateway
  (Unified Balance Kit) view, deposit, and **spend**: settle USDC out of the unified balance
  to any Gateway mainnet chain (burn on Base, mint on the destination), with Base as the
  settlement hub.
- **Analyze & research.** Inline conversational research: deterministic cited data cards for
  known topics + AI-streamed answers for free-form questions.
- **Portfolio & activity.** User and agent portfolios: open positions, realised and unrealised
  P&L, settlement history, and one unified activity timeline across every money path.

## Agent capabilities (your Circle Agent)

A research analyst and market operator running a tool-using Claude loop over a
server-custodied Circle wallet on Base Mainnet (ETH gas; a daily USD spending cap). Reads run
as the conversation goes; anything that moves money is previewed in the chat and executed
only after you reply "confirm" — the server mints a single-use confirmation id from your own
message and re-simulates a market trade right before it runs (`AGENT_MODE`, D-114). x402 paid
data is the agent's own pre-capped spend and needs no confirmation.

- **Wallet** auto-provisioned; view/manage, set the daily cap, and fund it by transferring
  USDC from your own wallet.
- **Positions** take and close YES/NO positions and combos on covered games, every one
  cap-checked, simulated immediately before execution, and recorded to the activity spine.
- **Move funds** send USDC and bridge it to any CCTP chain (funds land at _your_ wallet on
  the destination).
- **Treasury (Circle Gateway)** manages its own unified USDC balance: consolidate on Base,
  read the cross-chain breakdown, and settle USDC out to any Gateway mainnet chain on demand
  (spends to third parties count against the daily cap).
- **On-chain analysis (BaseScan).** Inspect any Base address (balance, activity, whale
  signals: accumulating/selling, stables↔tokens rotation), any token (holders, top-10
  concentration, safety red flags), and any transaction (decoded token movements).
- **Analyst workflow.** "Give me my daily briefing" → market pulse → portfolio review →
  on-chain highlights, figures first. Never blindly copies a wallet verifies hypotheses
  against live data.
- **Analyst advisor.** If the agent can't afford a position (balance or cap), it reads _your_
  wallet and if you hold enough delivers its analysis with a concrete "execute this
  yourself" recommendation.
- **Public track record & voice (Phase 13).** Claim a handle and the agent gets a public
  performance page derived from its chain-verified trades — realised/unrealised P&L, ROI,
  drawdown, exposure, risk, every market including the losses, labelled by execution mode —
  that nobody can edit; and, under a posting policy you approve template by template, it
  posts market updates, explain-the-move analysis and price-as-signal forecasts through the
  platform's X account, every post linted for compliance-safe wording.
- **Support desk (Phase 13).** A read-only support agent, signed in or not: how markets work,
  your own deposits, withdrawals, positions and transactions, deterministic troubleshooting,
  and a ticket to a person when it cannot resolve the problem.
- **x402 agent marketplace (buyer).** Access to Circle's full paid-services catalog
  ([agents.circle.com/services](https://agents.circle.com/services)) web search, news,
  weather, sports, prediction markets, social lookups, papers, SMS/communication APIs paid
  per-call in USDC (pre-capped, daily-capped, audited); the agent searches the marketplace
  before declining a request. HTTP-native x402 v2 buyer works in prod, no CLI
  ([setup](docs/x402-setup.md)).
- **x402 agent marketplace (seller, Phase 17).** Mantua also sells: six machine-readable
  services for external agents — market discovery, market intelligence, market trading (quote
  - calldata), portfolio exposure, hedging plans, and an allowlisted sports-intelligence
    pilot — at `/api/x402/v1/*`, priced from one catalog
    ([`server/src/lib/x402/catalog.ts`](server/src/lib/x402/catalog.ts)) and dark by default
    behind `X402_SELLER_ADDRESS` / `X402_SELLER_SERVICES`, plus the legacy `GET
/api/x402/analyst-brief` ($0.01) as the first-generation surface. Listing on Circle's
    Marketplace and flipping the seller env on are human steps gated on counsel sign-off
    (D-012); see [`docs/marketplace/offerings.md`](docs/marketplace/offerings.md) and
    [`docs/marketplace/become-a-seller.md`](docs/marketplace/become-a-seller.md).

## Institutional custody (Phase 18)

An institution is a segregated Circle wallet set, not a new money path. Members sign in with
Privy like anyone else; every member's agent wallet is created inside the institution's own
Circle wallet set (`provisionInstitutionWalletSet`, distinct from the retail wallet set), so
Circle's per-set Gas Station policy, screening, and reported balances scope to the institution
alone. Enforced at the three places money already passes:

- **Spend** — `checkSpendingCap` adds institution-wide per-trade and daily caps (summed across
  every member wallet) on top of the per-wallet cap, gated to members whose role may trade.
- **Send** — the agent's send path admits an institutional wallet only as the execution of an
  approved custody withdrawal, to its verified destination, for exactly that amount.
- **Wallet creation** — an institution without a provisioned wallet set refuses to create
  member wallets rather than silently falling back to the retail set.

**Dual control:** a destination is verified by someone other than whoever added it; a
withdrawal is approved by someone other than whoever requested it (auto-approved only below a
configurable threshold). Roles: owner, admin, trader, approver, viewer. Period statements and
Circle-vs-chain reconciliation are available as JSON or CSV. The institution's custody-grade
_principal_ stays with its own qualified custodian (Anchorage, BitGo, Coinbase Prime,
Fireblocks, Copper, …) — recorded, never integrated. Full spec:
[D-120](docs/decisions/v2-open-decisions.md) and
[`docs/tasks/074-institutional-custody.md`](docs/tasks/074-institutional-custody.md).

---

## Built with

### Uniswap v4

- **The Dynamic Market Hook** Mantua's one hook, deployed at a mined CREATE2 address, carried
  by every market's YES/USDC pool. Base Mainnet deployment is pending (address env-driven,
  `null` until deployed). Source: [`contracts/src/hooks/dynamic-market/`](contracts/src/hooks/dynamic-market).
- **v4 periphery** the canonical Base Mainnet stack — PoolManager, PositionManager,
  StateView, V4Quoter — plus the market pool's own periphery (its swap and liquidity routers,
  lens, and quoter), recorded per chain in `markets-contracts.ts`.
- Prices read through **StateView**; quotes through **V4Quoter**; all addresses live in
  [`server/src/lib/v4-contracts.ts`](server/src/lib/v4-contracts.ts) and
  [`server/src/lib/markets-contracts.ts`](server/src/lib/markets-contracts.ts).

### Circle

- **Developer-Controlled Wallets** (`@circle-fin/developer-controlled-wallets`) server-managed
  agent wallets (smart-contract accounts) that sign and execute on Base Mainnet;
  the user's signing key is never touched by the agent path.
- **CCTP via Bridge Kit** (`@circle-fin/bridge-kit`) native cross-chain USDC burn-and-mint to
  the CCTP-V2 mainnet chains (Ethereum, Arbitrum One, OP Mainnet, Polygon, Avalanche), used
  both by the app (user wallet) and server-side by the agent's Circle wallet (Circle-Wallets
  adapter + Forwarding Service).
- **Gateway via Unified Balance Kit** (`@circle-fin/unified-balance-kit` +
  `@circle-fin/adapter-circle-wallets` + `@circle-fin/adapter-viem-v2`) unified multi-chain
  USDC balance: deposits (agent SCA) and spends to any Gateway mainnet chain, signed by a
  Gateway **delegate** EOA on the SCA's behalf (SCAs can't sign burn intents directly).
- **x402 agent marketplace** (`@x402/fetch` + `@x402/extensions` Bazaar discovery) the full
  paid-services catalog at [agents.circle.com/services](https://agents.circle.com/services),
  paid per-call in USDC via EIP-3009 authorizations from the agent's buyer EOA. Mantua is also
  a **seller** (Phase 17): six machine-readable services — market discovery, market
  intelligence, market trading quote/calldata, portfolio exposure, hedging plans, sports
  intelligence — through a dual-rail paywall (Gateway nanopayments + vanilla exact), plus the
  legacy `GET /api/x402/analyst-brief` ($0.01); dark-by-default, go-live counsel-gated (D-012).
- **USDC** Circle's stablecoin, native on Base Mainnet: the collateral behind every market and
  the unit every balance and payout is quoted in.

### Base

- **Base Mainnet** (chain id `8453`) Coinbase's Ethereum L2. RPC
  `https://mainnet.base.org` (fallback `https://base-rpc.publicnode.com`); explorer
  [BaseScan](https://basescan.org).
- **BaseScan API** powers the agent's on-chain analysis tools (address activity,
  token holders, transaction decoding).

### Pyth Network

- **Hermes price feeds** the price source behind `getUsdPrice` for portfolio and balance
  valuation, with DefiLlama as automatic fallback.

### Application

- **Client** Vite + React + TypeScript SPA; Privy auth (embedded + external wallets), viem,
  lightweight-charts.
- **Server** Express + TypeScript API; Anthropic **Claude** (`claude-opus-4-8`) agent loop,
  Drizzle ORM + Postgres (Neon). Deployed on **Vercel** (serverless) with crons — sports-sync
  (ingest + on-chain market/pool creation), resolution (settlement), strategies (hedging
  ticks), and social posts. Game-day cadence comes from pointing any external scheduler at the
  same cron URLs.

---

## Network details

| Network          | Chain ID | RPC                        | Explorer             |
| ---------------- | -------- | -------------------------- | -------------------- |
| **Base Mainnet** | `8453`   | `https://mainnet.base.org` | https://basescan.org |

Gas is ETH (18 decimals). RPC overrides: `VITE_BASE_RPC_URL` (client), `BASE_RPC_URL`
(server and agent); fallback `https://base-rpc.publicnode.com`.

### Tokens (Base Mainnet)

| Token | Address                                      | Decimals | Notes                                         |
| ----- | -------------------------------------------- | -------- | --------------------------------------------- |
| USDC  | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6        | Circle USDC — market collateral, settlement   |
| EURC  | `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` | 6        | Circle EURC — supported wallet asset          |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8        | Coinbase Wrapped BTC — supported wallet asset |

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
> model ([D-105](docs/decisions/v2-open-decisions.md), user page
> [`docs/fee-model.md`](docs/fee-model.md)): **0% fees in the regular season; in the playoffs a
> dynamic 0.10%–0.70% rate** (liquidity, volatility, trading activity, market uncertainty — the
> 0.70% ceiling is an immutable constant) applied as `Fee = C × rate × p × (1 − p)`, so 50/50
> contracts pay the most and near-certain ones almost nothing. Plus per-risk trade caps, in-play
> trading that halts on the event's `FINAL` state with a keeper-independent 12-hour backstop
> that fires even with no keeper write, and fail-closed behaviour on stale keeper state. Security
> review: [`docs/security/dynamic-market-fee-review.md`](docs/security/dynamic-market-fee-review.md);
> the ship gate ([`docs/security/sign-off.md`](docs/security/sign-off.md)) awaits re-signing for
> the fee model.

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

### Mantua contracts — Base Mainnet deployment pending

Mantua's own contracts — DynamicMarketHook, MarketStateRegistry, MarketFactory, Resolver, and
the AgenticCommerce (ERC-8183) escrow — have **no mainnet addresses yet**. They are configured
through env overrides, default to `null`, and the app degrades gracefully until they are
deployed. The deployment + verification checklist lives in
[`docs/security/hook-deployments.md`](docs/security/hook-deployments.md); Foundry scripts
and per-deployment records live under [`deploy/`](deploy/).

Once deployed: each game's Market contract and YES/NO tokens are minted by the factory at
ingest time — deterministic ids, one market per side per game. The Resolver is the fixed
settlement authority every market burns in as an immutable; the keys behind it rotate
without redeploying a single market.

---

## Architecture

```
client/      Vite + React + TypeScript SPA (port 5173) the home board, docs, legal, market
             pages, the combo builder, the agent panel, the public agent page
             (/agents/<handle>), voice settings, and the support panel
server/      Express + TypeScript API (port 3001) market calldata builders, quotes, agent,
             portfolio, market id + probability utils, the derived performance ledger
             (lib/agent), social posting (lib/social), the support agent (lib/support),
             custody (lib/custody), the x402 seller catalog (lib/x402), Drizzle schema
contracts/   Foundry contracts: market primitives (MarketFactory, Market, OutcomeToken,
             Resolver, pool bootstrap), the Dynamic Market Hook (8 modules), full-lifecycle
             E2E tests, and the deploy scripts (contracts/script/)
deploy/      Foundry deploy scripts + per-chain deployment records for the market periphery,
             pool setup, and the agent-commerce escrow
docs/        Architecture, specs, decision memos, task lists, legal drafts
```

- **Wallets.** Users connect via Privy (embedded + external). Agents use **Circle
  Developer-Controlled Wallets** (server-managed smart-contract accounts on Base) the user's
  signing key is never touched by the agent path.
- **Market pools.** Every market pool resolves to the canonical Base Mainnet v4 stack plus the
  market periphery the factory bootstraps; the pool's hook is always the Dynamic Market Hook.

---

## Documentation

| Document                                                                                             | What it covers                                                               |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)                                                       | Living architecture notes and the decision log                               |
| [`docs/tasks/v2-roadmap.md`](docs/tasks/v2-roadmap.md)                                               | The current build plan: every phase, its rows, and what is done              |
| [`docs/decisions/v2-open-decisions.md`](docs/decisions/v2-open-decisions.md)                         | Every decision (D-xxx), its reasoning, and what it rules out                 |
| [`docs/specs/market-lifecycle.md`](docs/specs/market-lifecycle.md)                                   | Market states, transitions, failure modes                                    |
| [`docs/specs/market-id.md`](docs/specs/market-id.md)                                                 | Deterministic market ids                                                     |
| [`docs/specs/dynamic-market-hook.md`](docs/specs/dynamic-market-hook.md)                             | The authoritative hook spec (§1–§46) + implementation record                 |
| [`docs/fee-model.md`](docs/fee-model.md)                                                             | The fee model in user terms                                                  |
| [`docs/security/sign-off.md`](docs/security/sign-off.md)                                             | Ship-gate security sign-off — findings, rails, E2E proofs                    |
| [`docs/ops/incident-runbook.md`](docs/ops/incident-runbook.md)                                       | Kill switches, mis-resolution, provider failover, comms                      |
| [`docs/tasks/sports-pivot-scope-reconciliation.md`](docs/tasks/sports-pivot-scope-reconciliation.md) | What survives the original pivot, what is superseded, what is deferred       |
| [`docs/tasks/live-sports-reliability.md`](docs/tasks/live-sports-reliability.md)                     | Phase 7 — real-time stream, status ladder, trade state, load/chaos           |
| [`docs/ops/monitoring.md`](docs/ops/monitoring.md)                                                   | Latency budgets, metrics reads, the alert/paging policy                      |
| [`docs/tasks/070-agent-extended.md`](docs/tasks/070-agent-extended.md)                               | Phase 13 — the performance ledger, social posting, AI support                |
| [`docs/tasks/071-mobile-experience.md`](docs/tasks/071-mobile-experience.md)                         | Phase 15 — the phone: sheet ticket, live glance, push, PWA, budgets          |
| [`docs/tasks/072-prediction-market-combos.md`](docs/tasks/072-prediction-market-combos.md)           | Phase 16 — combos as conjunction markets                                     |
| [`docs/tasks/073-phase-17-agent-marketplace.md`](docs/tasks/073-phase-17-agent-marketplace.md)       | Phase 17 — the x402 seller catalog, dual-rail paywall, marketplace packaging |
| [`docs/marketplace/offerings.md`](docs/marketplace/offerings.md)                                     | The six x402 seller services: endpoint, price, auth, OpenAPI spec URL        |
| [`docs/marketplace/become-a-seller.md`](docs/marketplace/become-a-seller.md)                         | Circle Marketplace seller runbook — prerequisites, intake form, go-live gate |
| [`docs/tasks/074-institutional-custody.md`](docs/tasks/074-institutional-custody.md)                 | Phase 18 — segregated wallet sets, dual control, statements, reconciliation  |
| [`docs/tasks/075-home-page-restructure.md`](docs/tasks/075-home-page-restructure.md)                 | Phase 19 — why the landing page was removed, and where its content went      |

An in-app documentation site covering the same ground for users is reachable from the home
page's footer.

---

## Local development

```bash
npm install
# server (port 3001) + client (port 5173)
npm run dev
```

Requires Postgres + a `.env` (see `server/.env.example`, `client/.env.example`). Verify with:

```bash
npm run typecheck            # all workspaces
npm run lint                 # eslint, zero warnings tolerated
npm test -w @mantua/server   # node:test via tsx; needs a .env for the chain/provider suites
npm test -w @mantua/client   # node:test via tsx over the pure *-core modules
npm run e2e                  # browser suite: the real client in Chromium, auth shimmed, API + chain scripted
npm run e2e:mobile -w @mantua/client   # mobile suite: 360×740 + 430×932, touch, mobile UA
```

The market page's deeper layer (Phase 11, task 068) — depth ladder, live
game, research, fees and execution, past markets — is served by
`GET /api/markets/depth`, `/analysis`, and `/history` and proven by
`client/e2e/market.spec.ts`.

Voice input (Phase 12, task 069) puts a hold-to-speak microphone in the
command bar. It produces text and hands it to the same submit the Send
button uses, so a spoken command takes the pipeline a typed one takes.
`ELEVENLABS_API_KEY` stays server-side: `POST /api/voice/token` spends it
on a single-use token the browser opens the transcription socket with.
Set no key and the microphone is simply not offered. Speech can ask for
anything but can never confirm a trade — the server refuses to mint a
confirmation from a spoken turn, so Confirm stays a press
(`client/e2e/voice.spec.ts`).

Agent Extended (Phase 13, task 070) gives an agent a public record, a
voice, and a support desk. `GET /api/agents/<handle>` serves the canonical
performance ledger — derived on read from chain-verified fills, market
resolutions and the audit trail, never stored — with realised and
unrealised P&L, ROI, drawdown, exposure, a risk block, every market
including the losses, a breakdown by execution mode (simulated /
user-confirmed / autonomous), and a digest over all entries; the fills
table refuses UPDATE and DELETE at the database. The app answers
`/agents/<handle>` as a public page. A user claims the handle and a posting
policy at `PATCH /api/agent/social`; the fifteen-minute
`GET /api/cron/social-posts` tick composes market updates, explain-the-move
and price-as-signal posts from templates over live data, passes each
through a compliance lint and the user's cadence gate, and sends through
the deployment's X account (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
`X_ACCESS_TOKEN_SECRET`; absent → recorded dry runs). `POST
/api/support/chat` (SSE) and `POST /api/support/message` (JSON) run a
read-only support agent with a knowledge base, the caller's own account
context, deterministic troubleshooting flows and a human-escalation ticket.

The browser suite (`client/e2e/`, task 067) needs no Privy app id,
database, or chain: it starts Vite with `VITE_E2E_AUTH=shim` and answers
the API and the RPC from Playwright routes. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a preinstalled Chromium.

The mobile experience (Phase 15, task 071, D-118) reuses the desktop code
at two breakpoints (`client/src/lib/mobile.ts`): below `lg` the trade
ticket becomes a bottom sheet, below `md` the header nav moves behind a
hamburger. Web Push (`server/src/lib/push/`) runs on `node:crypto` alone
(RFC 8291/8292, no external push library) across five topics — trades,
positions, games, agent, settlement — dark unless its three VAPID env
vars are set. The install prompt, manifest and service worker live under
`client/src/features/pwa/`. `client/playwright.mobile.config.ts` runs
`client/e2e/mobile/` at 360×740 and 430×932 against a production build
so the mobile budgets in `client/src/lib/mobile-budgets.ts` are enforced
for real.

Prediction market combos (Phase 16, task 072, D-119) let a user buy a
parlay-style ticket across two or more games as one position: a combo is a
full-collateral conjunction market minted through the existing factory,
priced at the product of its legs' fair probabilities, and settled YES
only if every leg wins. `POST /api/combos/prepare`, `/quote`, and
`/calldata` create, price, and execute it in a single transaction;
`combo-rules.ts` and the user's `combo` policy block gate what can be
combined.

The Circle Agent Marketplace (Phase 17, task 073, D-106) makes Mantua a
paid **seller** as well as a buyer: six machine-readable services under
`/api/x402/v1/*` (market discovery, market intelligence, market trading
quote/calldata, portfolio exposure, hedging plans, sports intelligence),
priced from one catalog and served through a dual-rail paywall (Circle
Gateway nanopayments + vanilla x402 `exact`, both in one 402 response).
Each service publishes its own unpaid OpenAPI 3.1 document at
`GET /api/x402/openapi/:serviceId.json` (index: `/api/x402/openapi.json`),
kept honest by a catalog↔spec parity test. Dark by default behind
`X402_SELLER_ADDRESS` / `X402_SELLER_SERVICES`; listing on Circle's
Marketplace and flipping the env on are human steps gated on counsel
sign-off (D-012) — see
[`docs/marketplace/become-a-seller.md`](docs/marketplace/become-a-seller.md).

Institutional custody (Phase 18, task 074, D-120) adds an account tier
where an institution is a segregated Circle wallet set: members' agent
wallets are created inside it, institution-wide caps sit on top of the
per-wallet cap, withdrawals go only to verified custodian addresses under
dual control, and period statements plus Circle-vs-chain reconciliation
are available as JSON or CSV. Operator surface: `/api/ops/institutions`
behind `requireOpsAuth` (`MANTUA_OPS_KEY`).

The home page restructure (Phase 19, task 075, D-121) removed the
standalone marketing page: `/` now resolves directly to the board (the
`home` route) for every visitor, logged in or not, with the marketing
page's Documentation link, social channels, and legal links carried over
into a footer on the home page itself (`client/src/components/shell/Footer.tsx`).

### Contracts

```bash
cd contracts
forge test    # market primitives, the Dynamic Market Hook suite, invariants, full-lifecycle E2E
```

> **Dependencies are not vendored.** `contracts/lib/` is gitignored, so a fresh checkout has no
> forge-std, solmate, OpenZeppelin, v4-core, or v4-periphery and the Solidity will not compile
> until they are installed. They are not yet pinned as submodules; install them into
> `contracts/lib/` before building.

Optional: the agent can pay per-call for premium data via the x402
marketplace (off by default; set `X402_ENABLED=1` + fund the buyer wallet)
see [`docs/x402-setup.md`](docs/x402-setup.md).

## Deploying the on-chain stack

Foundry scripts for deploying the market periphery / pool setup live under
[`deploy/`](deploy/) each with a README and the exact `forge script` commands
(all use `--via-ir --optimizer-runs 200`).
