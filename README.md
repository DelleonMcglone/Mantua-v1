# Mantua.AI

**Mantua is an agent-driven prediction market for sports.** Bettors and market makers open
positions, provide liquidity, and execute automated hedging strategies through natural language.
It combines a custom suite of **Mantua hooks**, autonomous **AI agents** running **Circle
Developer-Controlled Wallets**, and real-time on-chain execution to turn user intent into
automated market actions a programmable liquidity layer for sports outcomes, live in-game
markets, and USDC-settled event contracts.

From a single natural-language prompt you can:

- **Take a position** on a scheduled game, priced continuously by the pool rather than by a
  bookmaker.
- **Provide liquidity** to market pools and to the base pairs, and manage those positions.
- **Analyze & research** matchups, pool health, peg status, and token prices (free data, with
  optional pay-per-call x402 premium sources).
- **Swap** USDC, EURC, and cbBTC across the hook pools.
- **Run an autonomous agent** a Circle-managed wallet that researches, takes positions, manages
  liquidity, and hedges under a spending cap.
- **Bridge & manage treasury** move USDC cross-chain (Circle CCTP) and hold a unified,
  multi-chain USDC balance (Circle Gateway).

> **Status: live at [mantua.ai](https://mantua.ai) on Base Mainnet (8453).** The app —
> swaps, liquidity, agent, analytics — runs against Base Mainnet. **Mantua's own contracts
> (the hooks, the market factory/resolver, and the agent-commerce escrow) are awaiting their
> Base Mainnet deployment**; until they are deployed, hook-gated pools and on-chain market
> minting stay dark and the app degrades gracefully (addresses are env-driven, `null` by
> default). [`docs/tasks/sports-pivot.md`](docs/tasks/sports-pivot.md) tracks the build plan
> (phases B0–B10 complete; a handful of P2/P3 refinements remain), and
> [`docs/security/hook-deployments.md`](docs/security/hook-deployments.md) tracks the
> deployment checklist.

## Network

Mantua runs on a single chain: **Base Mainnet**.

| Network          | Chain id | Gas token | What runs there                                                                                                                                                            |
| ---------------- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Base Mainnet** | `8453`   | ETH       | Full stack: sports markets (Dynamic Market hook + factory/resolver, deployment pending), Stable Protection (USDC/EURC, deployment pending), swaps, liquidity, agent wallet |

The wallet, swaps, liquidity, and the Circle agent wallet all target Base Mainnet. Contract
addresses live in
[`server/src/lib/v4-contracts.ts`](server/src/lib/v4-contracts.ts) and
[`server/src/lib/markets-contracts.ts`](server/src/lib/markets-contracts.ts); the hook
deployment status is attested in
[`docs/security/hook-deployments.md`](docs/security/hook-deployments.md).

## The problem and who it's for

Prediction markets are static. Odds and liquidity sit passively while the world moves, so market
makers get picked off the moment news breaks and bettors trade against stale depth. Mantua makes
the market itself programmable: fees adapt to order-flow imbalance, access is enforced at
execution, and trading halts under conditions the market defines in advance. **Bettors, market
makers, and liquidity providers** set all of it from natural-language instructions, executed
on-chain through agent-managed Mantua hooks.

## Why it's better

Prediction markets today are passive. Mantua makes them **state-aware, fee-adaptive,
oracle-enforced, and agent-managed** by embedding these behaviors directly into AMM execution
logic through Mantua hooks. By letting AI agents coordinate liquidity in response to real-time
market conditions, Mantua transforms prediction-market liquidity from static capital into an
automated financial control system for compliant access, market making, and event settlement.

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
  together they are the arbitrage floor that keeps the pool price inside [0, 1].
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
3. **Combines paid intelligence with live sports and on-chain signals** game state, pool
   health, peg status, whale flows.
4. **Executes through Mantua hooks + a Circle Developer-Controlled Wallet** take a position,
   swap, provide liquidity, bridge via CCTP.
5. **Manages the position** hedging strategies fire on price and game-state ticks under a
   policy cap, and auto-disarm when a market freezes.

Programmable money buying programmable intelligence, then acting on it in one autonomous loop.

**Programmable Sports Agents**

---

## App capabilities

- **Universal command bar.** One input routes every command by intent a card only _starts_ a
  mode, it never locks it. Hookless actions and agent commands go to the Circle Agent; naming a
  hook (Stable Protection / Dynamic Fee) opens the manual Uniswap-v4 panel; research questions
  open Analyze.
- **Sports markets.** A cross-league **Discover** page (filter by league, team, game, status,
  start time, liquidity, popularity — or just type "What can I trade right now?") and
  full-screen per-league pages: date-grouped games with contract prices fed by the **live pool
  price**, each labelled with its source (market price vs. projection), and a **trade ticket**
  — price tap, amount tap, Confirm: three taps to a trade, two to close. The ticket shows the
  hook's exact fee (Position / Fee / Fee rate / Total, 0% in the regular season), ends in an
  explicit **Trade executed** card, offers **Add funds** inline (bank or USDC) when the balance
  is short, and never mentions gas, a network, or an address. Browsing and matchup details are
  open to everyone; anonymous visitors also get **three free analyst questions a day**
  (enforced server-side), after which chat and every transaction require login.
- **Automated hedging strategies.** Describe one in plain language ("take profit at 80% on the
  Chiefs"), confirm the structured preview, and it arms: evaluated on price and game-state
  ticks, sized under its own USDC cap, armed straight through the game and auto-disarmed when
  the market closes. Kill switches at every level; every transition audited.
- **State-aware Mantua hooks.** Custom hooks embed pricing, fee logic, and circuit breakers
  directly into pool execution. Stable Protection is **FX-aware**: its circuit breaker anchors
  to the live EUR/USD rate (Pyth) instead of assuming 1:1, so USDC/EURC trades at the true
  ~1.14 rate (see [Hooks](#hooks)).
- **Swap · Liquidity Pools.** Manual v4 swaps with live quotes and hook selection; create
  pools and add/remove liquidity (market-priced initialization); pool detail pages with real
  pair exchange-rate charts.
- **Cross-chain USDC bridging.** Outbound from Base to the CCTP-V2 mainnet chains Ethereum,
  Arbitrum One, OP Mainnet, Polygon, Avalanche via Circle CCTP (Bridge Kit), with Base as the
  home chain.
- **Unified balance / treasury.** A single multi-chain USDC balance via Circle Gateway
  (Unified Balance Kit) view, deposit, and **spend**: settle USDC out of the unified balance
  to any Gateway mainnet chain (burn on Base, mint on the destination), with Base as the
  settlement hub.
- **Analyze & research.** Inline conversational research: deterministic cited data cards for
  known topics + AI-streamed answers for free-form questions.
- **Portfolio & earnings.** User + agent portfolios, LP positions, and fee earnings with an
  estimated LP/hook split grouped by hook.

## Agent capabilities (your Circle Agent)

A financial analyst, trader and liquidity provider running a tool-using Claude loop over a
server-custodied Circle wallet on Base Mainnet (ETH gas; a daily USD spending cap). Reads run
as the conversation goes; anything that moves money is previewed in the chat and executed
only after you reply "confirm" — the server mints a single-use confirmation id from your own
message and re-simulates a market trade right before it runs (`AGENT_MODE`, D-114). x402 paid
data is the agent's own pre-capped spend and needs no confirmation.

- **Wallet** auto-provisioned; view/manage, set the daily cap, and fund it by transferring
  USDC from your own wallet.
- **Trade & move** swap (signal-guarded: peg deviation + price impact), send, and bridge USDC
  to any CCTP chain (funds land at _your_ wallet on the destination).
- **Treasury (Circle Gateway)** manages its own unified USDC balance: consolidate on Base,
  read the cross-chain breakdown, and settle USDC out to any Gateway mainnet chain on demand
  (spends to third parties count against the daily cap).
- **FX best execution (StableFX)** for USDC↔EURC the agent compares Circle's **StableFX**
  RFQ rate, the live on-chain pool rate, and the Pyth interbank EUR/USD reference, then
  recommends the better venue (executing on-chain when the pool wins), citing the spread vs
  interbank.
- **Liquidity** create no-hook pools at the live market price, add/remove liquidity, list
  positions.
- **On-chain analysis (BaseScan).** Inspect any Base address (balance, activity, whale
  signals: accumulating/selling, stables↔tokens rotation), any token (holders, top-10
  concentration, safety red flags), and any transaction (decoded token movements).
- **Analyst workflow.** "Give me my daily briefing" → market pulse → peg check → portfolio
  review → on-chain highlights, figures first. Never blindly copies a wallet verifies
  hypotheses against live data.
- **Analyst advisor.** If the agent can't afford a trade (balance or cap), it reads _your_
  wallet and if you hold enough delivers its analysis with a concrete "execute this
  yourself" recommendation.
- **Autonomous de-peg rebalancing.** Opt-in: auto-exits a stablecoin that drifts off peg into
  the on-peg reference signal-gated, capped, audited on a daily cron.
- **x402 agent marketplace.** Access to Circle's full paid-services catalog
  ([agents.circle.com/services](https://agents.circle.com/services)) web search, news,
  weather, sports, prediction markets, social lookups, papers, SMS/communication APIs paid
  per-call in USDC (pre-capped, daily-capped, audited); the agent searches the marketplace
  before declining a request. HTTP-native x402 v2 buyer works in prod, no CLI
  ([setup](docs/x402-setup.md)).

---

## Built with

### Uniswap v4

- **Custom hooks** Mantua hooks, each deployed at a mined CREATE2 address: the Dynamic
  Market Hook (prediction markets), Stable Protection, and Dynamic Fee. Base Mainnet
  deployment is pending (addresses env-driven, `null` until deployed). Source repos linked
  under [Architecture](#architecture).
- **v4 periphery** the canonical Base Mainnet stack — PoolManager, PositionManager,
  StateView, V4Quoter, UniversalRouter. The app routes each pool's create / liquidity /
  swap / read through `getV4StackForHook`.
- **Permit2** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) for gas-efficient LP approvals.
- Quotes via **V4Quoter**; all addresses live in
  [`server/src/lib/v4-contracts.ts`](server/src/lib/v4-contracts.ts).

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
- **StableFX** (`POST /v1/exchange/stablefx/quotes`) Circle's institutional stablecoin FX
  engine; the agent pulls RFQ reference quotes for USDC↔EURC and compares them against
  on-chain liquidity for best execution.
- **x402 agent marketplace** (`@x402/fetch` + `@x402/extensions` Bazaar discovery) the full
  paid-services catalog at [agents.circle.com/services](https://agents.circle.com/services),
  paid per-call in USDC via EIP-3009 authorizations from the agent's buyer EOA (Mantua is also
  a **seller**: `GET /api/x402/analyst-brief`, $0.01).
- **USDC + EURC** Circle's stablecoins, native on Base Mainnet.

### Base

- **Base Mainnet** (chain id `8453`) Coinbase's Ethereum L2. RPC
  `https://mainnet.base.org` (fallback `https://base-rpc.publicnode.com`); explorer
  [BaseScan](https://basescan.org).
- **BaseScan API** powers the agent's on-chain analysis tools (address activity,
  token holders, transaction decoding).

### Pyth Network

- **Hermes price feeds** primary price source behind `getUsdPrice` and the peg signals
  (USDC/USD, EURC/USD, BTC/USD, EUR/USD FX), with DefiLlama as automatic fallback. The EURC peg
  is measured FX-neutrally (EURC/USD ÷ EUR/USD).
- **Peg keeper** a daily cron pushes the live EUR/USD reference on-chain to the FX-aware
  Stable Protection hook (`setPegReference`), anchoring its circuit breaker to the real rate.

### Application

- **Client** Vite + React + TypeScript SPA; Privy auth (embedded + external wallets), viem,
  lightweight-charts.
- **Server** Express + TypeScript API; Anthropic **Claude** (`claude-opus-4-8`) agent loop,
  Drizzle ORM + Postgres (Neon). Deployed on **Vercel** (serverless) with daily crons —
  sports-sync (ingest + on-chain market/pool creation), resolution (settlement), strategies
  (hedging ticks), agent rebalance, and Pyth peg-sync. Game-day cadence comes from pointing any
  external scheduler at the same cron URLs.

---

## Network details

| Network          | Chain ID | RPC                        | Explorer             |
| ---------------- | -------- | -------------------------- | -------------------- |
| **Base Mainnet** | `8453`   | `https://mainnet.base.org` | https://basescan.org |

Gas is ETH (18 decimals). RPC overrides: `VITE_BASE_RPC_URL` (client), `BASE_RPC_URL`
(server and agent); fallback `https://base-rpc.publicnode.com`.

### Tokens (Base Mainnet)

| Token   | Address                                      | Decimals | Notes                          |
| ------- | -------------------------------------------- | -------- | ------------------------------ |
| USDC    | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6        | Circle USDC, market collateral |
| EURC    | `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` | 6        | Circle EURC                    |
| cbBTC   | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8        | Coinbase Wrapped BTC           |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |          | Canonical (all chains)         |

---

## Hooks

Mantua ships three hooks. Because Uniswap v4 allows **one hook per pool key**, each is a distinct
contract deployed at a mined CREATE2 address. On Base Mainnet they deploy against the canonical
v4 stack (PoolManager + PositionManager + StateView + V4Quoter); the app routes every pool's
create / liquidity / swap / read through `getV4StackForHook`.

| Hook                    | Surface           | Purpose                                                                                     | Target                        | Source                                                                           |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| **Dynamic Market Hook** | Prediction market | Adapts pricing, fees, liquidity, and risk parameters in real time from game state and flow  | Base Mainnet (deploy pending) | [`contracts/src/hooks/dynamic-market/`](contracts/src/hooks/dynamic-market)      |
| **Stable Protection**   | Trading           | Monitors peg deviation across five zones, scaling LP fees to severity and halting past 5%   | Base Mainnet (deploy pending) | [stableprotection-hook](https://github.com/DelleonMcglone/stableprotection-hook) |
| **Dynamic Fee**         | Trading           | Nezlobin directional fees across five deviation zones, charging the toxic side of the trade | Base Mainnet (deploy pending) | [dynamic-fee](https://github.com/DelleonMcglone/dynamic-fee)                     |

The Dynamic Market Hook's eight Solidity modules live in this repo under
[`contracts/src/hooks/dynamic-market/`](contracts/src/hooks/dynamic-market), alongside the
market primitives in [`contracts/src/markets/`](contracts/src/markets) and the Foundry deploy
scripts in [`contracts/script/`](contracts/script). Stable Protection and Dynamic Fee each
have their own repository and are wired in here as **git submodules** under
`contracts/hooks/`, so GitHub shows them as pointers rather than inline files — clone them
with the repo:

```bash
git clone --recurse-submodules https://github.com/DelleonMcglone/Mantua-Intelligence.git
```

> The Dynamic Market Hook shipped against the authoritative spec in
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

> Two further hooks **RWA Gate** (permissioned pools via a ComplianceRegistry) and
> **Async Limit Order** are built but **deferred** — they join a later deployment wave,
> where RWA-grade tokens better match their use cases.

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
| UniversalRouter | `0x6fF5693b99212Da76ad316178A184AB56D299b43` |
| Permit2         | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

### Mantua contracts — Base Mainnet deployment pending

Mantua's own contracts — DynamicMarketHook, MarketStateRegistry, MarketFactory, Resolver,
StableProtectionHook, DynamicFee, and the AgenticCommerce (ERC-8183) escrow — have **no
mainnet addresses yet**. They are configured through env overrides
(`STABLE_PROTECTION_HOOK_ADDRESS`, `DYNAMIC_FEE_HOOK_ADDRESS`, and the markets/commerce
equivalents), default to `null`, and the app degrades gracefully until they are deployed.
The deployment + verification checklist lives in
[`docs/security/hook-deployments.md`](docs/security/hook-deployments.md); Foundry scripts
and per-deployment records live under [`deploy/`](deploy/).

Once deployed: each game's Market contract and YES/NO tokens are minted by the factory at
ingest time — deterministic ids, one market per side per game. The Resolver is the fixed
settlement authority every market burns in as an immutable; the keys behind it rotate
without redeploying a single market.

Hook permission bits and PoolManager wiring are verified by `npm run verify:hooks`,
attested in
[`docs/security/hook-deployments.md`](docs/security/hook-deployments.md).

---

## Architecture

```
client/      Vite + React + TypeScript SPA (port 5173) landing, docs, legal, market pages,
             swap/LP/agent panels
server/      Express + TypeScript API (port 3001) calldata builders, quotes, agent, portfolio,
             market id + probability utils, Drizzle schema
contracts/   Foundry contracts: market primitives (MarketFactory, Market, OutcomeToken,
             Resolver, pool bootstrap), the Dynamic Market Hook (8 modules), full-lifecycle
             E2E tests, and the deploy scripts (contracts/script/). The Stable Protection and
             Dynamic Fee hooks are submodules under contracts/hooks/
deploy/      Foundry deploy scripts + per-chain deployment records for the hook v4 periphery,
             pool setup, and the agent-commerce escrow
docs/        Architecture, specs, decision memos, task lists, legal drafts
```

- **Per-hook routing.** `getV4StackForHook(poolKey.hooks)` resolves the PoolManager + periphery
  for a pool from its hook address. On Base Mainnet all pools resolve to the canonical v4 stack.
- **Wallets.** Users connect via Privy (embedded + external). Agents use **Circle
  Developer-Controlled Wallets** (server-managed smart-contract accounts on Base) the user's
  signing key is never touched by the agent path.
- **Hook source repos.** [stableprotection-hook](https://github.com/DelleonMcglone/stableprotection-hook) ·
  [dynamic-fee](https://github.com/DelleonMcglone/dynamic-fee) ·
  [RWAgate](https://github.com/DelleonMcglone/RWAgate) ·
  [limit-orders](https://github.com/DelleonMcglone/limit-orders) (the last two are
  mainnet-deferred)

---

## Documentation

| Document                                                                                             | What it covers                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`docs/architecture.md`](docs/architecture.md)                                                       | Living architecture notes and the decision log                     |
| [`docs/tasks/sports-pivot.md`](docs/tasks/sports-pivot.md)                                           | The build plan phases, priorities, and what is done                |
| [`docs/decisions/sports-pivot-decisions.md`](docs/decisions/sports-pivot-decisions.md)               | Each decision, its reasoning, and what it rules out                |
| [`docs/specs/market-lifecycle.md`](docs/specs/market-lifecycle.md)                                   | Market states, transitions, failure modes                          |
| [`docs/specs/market-id.md`](docs/specs/market-id.md)                                                 | Deterministic market ids                                           |
| [`docs/specs/dynamic-market-hook.md`](docs/specs/dynamic-market-hook.md)                             | The authoritative hook spec (§1–§46) + implementation record       |
| [`docs/security/sign-off.md`](docs/security/sign-off.md)                                             | Ship-gate security sign-off — findings, rails, E2E proofs          |
| [`docs/ops/incident-runbook.md`](docs/ops/incident-runbook.md)                                       | Kill switches, mis-resolution, provider failover, comms            |
| [`docs/tasks/sports-pivot-scope-reconciliation.md`](docs/tasks/sports-pivot-scope-reconciliation.md) | What survives the pivot, what is superseded, what is deferred      |
| [`docs/tasks/live-sports-reliability.md`](docs/tasks/live-sports-reliability.md)                     | Phase 7 — real-time stream, status ladder, trade state, load/chaos |
| [`docs/ops/monitoring.md`](docs/ops/monitoring.md)                                                   | Latency budgets, metrics reads, the alert/paging policy            |

An in-app documentation site covering the same ground for users is reachable from the landing
footer.

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
npm test -w @mantua/server   # 937 tests
npm test -w @mantua/client   # 240 tests
npm run e2e                  # browser suite: the real client in Chromium, auth shimmed, API + chain scripted
```

The market page's deeper layer (Phase 11, task 068) — depth ladder, live
game, research, fees and execution, past markets — is served by
`GET /api/markets/depth`, `/analysis`, and `/history` and proven by
`client/e2e/market.spec.ts`.

The browser suite (`client/e2e/`, task 067) needs no Privy app id,
database, or chain: it starts Vite with `VITE_E2E_AUTH=shim` and answers
the API and the RPC from Playwright routes. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a preinstalled Chromium.

### Contracts

```bash
cd contracts
forge test    # 204 tests: market primitives, hook suites, invariants, full-lifecycle E2E
```

> **Dependencies are not vendored.** `contracts/lib/` is gitignored, so a fresh checkout has no
> forge-std, solmate, OpenZeppelin, v4-core, or v4-periphery and the Solidity will not compile
> until they are installed. They are not yet pinned as submodules; install them into
> `contracts/lib/` before building.

Optional: the agent can pay per-call for premium data via the x402
marketplace (off by default; set `X402_ENABLED=1` + fund the buyer wallet)
see [`docs/x402-setup.md`](docs/x402-setup.md).

## Deploying the on-chain stacks

Foundry scripts for re-deploying the per-hook periphery / pool setup live under
[`deploy/`](deploy/) each with a README and the exact `forge script` commands
(all use `--via-ir --optimizer-runs 200`).
