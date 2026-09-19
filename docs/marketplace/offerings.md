# Mantua on the Circle Agent Marketplace — the offerings

> Phase 17 (MP-002). Every endpoint, price, and spec URL below is copied from
> the shipped catalog (`server/src/lib/x402/catalog.ts`) — the single pricing
> source of truth the routes, 402 metadata, and OpenAPI parity test read from.
> This document packages that catalog for Circle's Agent Marketplace review;
> when a price changes, the catalog changes first and this file follows.
>
> **Go-live posture (D-012, D-106):** every surface ships env-gated dark.
> Flipping the seller env on and submitting the marketplace intake form are
> human steps gated on counsel sign-off — see
> `docs/marketplace/become-a-seller.md`. Nothing here is live by default.

## How an external agent buys

1. **Discover.** The agent reads the free service index
   (`GET /api/x402/v1/services.json`) or the marketplace catalog, then fetches
   the service's unpaid OpenAPI spec (`GET /api/x402/openapi/<serviceId>.json`).
2. **Probe.** An unpaid request returns `402` with a `PAYMENT-REQUIRED` header
   offering **both rails in one `accepts` array** — Circle Gateway
   nanopayments (gasless, sub-cent, batch-settled) and vanilla onchain x402
   (`exact` scheme, USDC on Base Mainnet, `eip155:8453`).
3. **Pay.** The agent picks its rail. For the sports-intelligence service the
   middleware checks the payer against the allowlist **before** settlement —
   a refused payer gets `403 x402_payer_not_authorized` and is never charged.
4. **Settle + serve.** The paywall settles via the facilitator, one
   `agent_x402_sale` audit row lands (payer, service, price), and the handler
   serves JSON.

Two properties worth stating plainly, because agents price them in:

- **Payment is the auth.** No API keys, no accounts, no Privy session — a
  settled payment entitles the request. x402 never touches user Privy wallets
  or the Circle agent-wallet budget (D-106 non-goals).
- **Typed refusals are answers, not errors.** `cap_blocked` (payer hit the
  C-019 daily cap), `BETTING_CLOSED`, `TRADING_HALTED`, `NO_MARKET` are
  definitive responses to a purchased request — the caller paid for the truth
  and got it.

## The six offerings

Six capability families; the trading family exposes two endpoints. Service
ids are the catalog's `X402_SELLER_SERVICES` values.

| #   | Family (task row)             | Service id            | Endpoint                               | Default price | Auth                | OpenAPI spec                                 |
| --- | ----------------------------- | --------------------- | -------------------------------------- | ------------- | ------------------- | -------------------------------------------- |
| 1   | Market discovery (MP-005)     | `market-discovery`    | `GET /api/x402/v1/markets/discover`    | $0.001        | payment             | `/api/x402/openapi/market-discovery.json`    |
| 2   | Market intelligence (MP-006)  | `market-intelligence` | `GET /api/x402/v1/intelligence/market` | $0.01         | payment             | `/api/x402/openapi/market-intelligence.json` |
| 3   | Trading — quote (MP-007)      | `trading-quote`       | `POST /api/x402/v1/trading/quote`      | $0.005        | payment             | `/api/x402/openapi/trading-quote.json`       |
| 4   | Trading — calldata (MP-007)   | `trading-calldata`    | `POST /api/x402/v1/trading/calldata`   | $0.02         | payment             | `/api/x402/openapi/trading-calldata.json`    |
| 5   | Portfolio & exposure (MP-009) | `portfolio-exposure`  | `GET /api/x402/v1/portfolio/exposure`  | $0.005        | payment             | `/api/x402/openapi/portfolio-exposure.json`  |
| 6   | Hedging (MP-010)              | `hedging`             | `GET /api/x402/v1/hedging/plan`        | $0.01         | payment             | `/api/x402/openapi/hedging.json`             |
| —   | Sports intelligence (MP-011)  | `sports-intelligence` | `GET /api/x402/v1/sports/context`      | $0.01         | allowlist + payment | `/api/x402/openapi/sports-intelligence.json` |

Sports intelligence is the **pilot** for partner-gated data: it is allowlisted
on top of payment (`X402_SPORTS_INTEL_ALLOWLIST`), so it does not count among
the six openly listed families — it is listed for the partners on the
allowlist, and an empty allowlist keeps it dark (fail-closed).

MP-008 does not exist in the owner's phase list; six services, not seven.

### Listing copy

Market discovery — _Mantua market discovery._ "Filterable upcoming sports
market slate with liquidity and popularity." The entry point: which games are
coming up, how deep the liquidity is, where the attention is. One cent of a
dollar per call; the cheapest way to find out whether Mantua has a market
worth trading.

Market intelligence — _Mantua market intelligence._ "Win probability,
liquidity, price movement, and sports context for one market." The analysis
surface: the probability engine's read on a single outcome-token market, with
the sports context behind it, in one call.

Trading, quote — _Mantua trading quote._ "Pre-trade quote for one
outcome-token market trade, with remaining daily cap." A pre-trade quote with
the payer's remaining daily cap state, so an agent can budget a session of
trades before it signs anything.

Trading, calldata — _Mantua trading calldata._ "Execution-ready market trade
calldata; the caller signs with its own wallet." Advisory + calldata by
design (owner-locked fork): the service returns quote and cap state alongside
execution-ready calldata, the caller signs and executes with its own wallet,
and the server holds no keys and executes nothing. Typed refusals
(`cap_blocked`, `BETTING_CLOSED`, `TRADING_HALTED`, `NO_MARKET`) pass through
unchanged — a purchased refusal is a definitive answer.

Portfolio & exposure — _Mantua portfolio & exposure._ "Positions, portfolio
value, and exposure for any Base address — public chain state only."
Deliberately limited to what is already public on-chain: an agent can read a
wallet's exposure without any identity handshake.

Hedging — _Mantua hedging plans._ "Predefined hedge-strategy templates as
concrete quote-ready legs — arms nothing." Each leg is a quote an agent can
feed straight to the trading service; the strategy store and the execution
engine stay internal (B9-004 discipline).

Sports intelligence — _Mantua sports intelligence (pilot)._ "Honesty-status
game context and live odds for allowlisted partners." The honest-data
contract (`unavailable` / `not_found` / `ambiguous` + `didYouMean`) plus live
odds, for partners on the allowlist. Refused payers are turned away before
settlement and never charged.

## First-generation surface (legacy)

`GET /api/x402/analyst-brief` — the platform's live analyst brief (pegs,
market pulse, narratives, TVL movers) for **$0.01 USDC**, vanilla-rail only.
This is the **first-generation** listing: it predates the catalog and the
dual-rail paywall and stays exactly as it is — no migration churn. It is
listed in the marketplace as the original surface; the six offerings above
are the second generation.

## Shipping status (reads against `origin/main`)

| Surface                                                                         | Where it ships                                                                                 | Status                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| Catalog + dual-rail paywall + `agent_x402_sale` audit (MP-004)                  | PR #61 (`3b2c329`) — `server/src/lib/x402/catalog.ts`, `server/src/middleware/x402-paywall.ts` | ✅ shipped, tested       |
| Trading quote + calldata routes (MP-007)                                        | PR #61 — `server/src/routes/x402-trading.ts`                                                   | ✅ shipped, tested       |
| Offerings doc (MP-002), seller runbook (MP-003), task doc, roadmap + D-106 rows | this PR (`docs/phase-17-marketplace`)                                                          | ✅ this PR               |
| Remaining service routes (MP-005, MP-006, MP-009, MP-010, MP-011)               | parallel `feat/x402-services` PR                                                               | 🟡 in flight             |
| OpenAPI publication + `services.json` + parity test                             | staged behind the services PR                                                                  | 🟡 in flight             |
| Env flip + intake-form submission + go-live                                     | human steps                                                                                    | ⬜ counsel-gated (D-012) |

Until the OpenAPI PR lands, the spec URLs above name the routes the parity
test will enforce; the endpoints and prices are already authoritative — they
are read from the catalog on `main`.
