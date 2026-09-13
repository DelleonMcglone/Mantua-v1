# Mantua AI v2 - Base Mainnet Task List

> **Build:** Full rebuild from scratch
> **Network:** Base Mainnet (Chain ID: 8453) ONLY
> **Launch:** Public mainnet launch — no allowlist gating
> **Design:** Full UI/UX overhaul — see design files (`Mantua Prototype.html` + README) for the authoritative spec. The old Hyperliquid-inspired teal (#14b8a6) palette from v1 is superseded.
> **Last Updated:** 2026-04-26 (decisions locked: D-002 hooks override, D-003 AI security analysis, D-004–D-010/D-013/D-014 accepted, D-011/D-012 risk-accepted)

---

## 🎯 OVERHAUL OBJECTIVE

Rebuild Mantua AI from scratch as a production-grade, AI-powered DeFi platform on Base Mainnet. Every feature must work end-to-end with verifiable on-chain transactions. No placeholders. No TODOs. Test everything. Mainnet-safe from day one.

---

## 🔗 Supported Network

| Network      | Chain ID | Status      | Block Explorer        |
| ------------ | -------- | ----------- | --------------------- |
| Base Mainnet | 8453     | 🚧 To build | https://basescan.org/ |

**No testnets.** All development against mainnet forks (Anvil) during dev; real mainnet for staging/prod.

---

## 🪙 Supported Tokens (Base Mainnet)

| Token                | Symbol | Address                                      | Decimals | CoinGecko ID         |
| -------------------- | ------ | -------------------------------------------- | -------- | -------------------- |
| Ethereum             | ETH    | Native (0x0)                                 | 18       | ethereum             |
| Coinbase Wrapped BTC | cbBTC  | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8        | coinbase-wrapped-btc |
| USD Coin             | USDC   | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6        | usd-coin             |
| Euro Coin            | EURC   | `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` | 6        | euro-coin            |

> ⚠️ Token addresses above are Base Mainnet canonical addresses — verify each against the issuer's official docs before hardcoding (P1-002). The registry lives in `server/src/lib/tokens.ts`.

---

## 🔑 Required Credentials

```env
# Privy (wallet + auth provider) — D-005, D-006 ACCEPTED
VITE_PRIVY_APP_ID=<your_privy_app_id>
PRIVY_APP_SECRET=<your_privy_app_secret>  # Server-side only, never expose to client

# WalletConnect — D-007 ACCEPTED: required for mobile external wallets via Privy
VITE_WALLETCONNECT_PROJECT_ID=<your_walletconnect_project_id>

# Uniswap Trading API
UNISWAP_TRADING_API_KEY=<your_uniswap_api_key>

# Circle Developer-Controlled Wallets (Agent wallets) — D-008 boundary, provider per D-110
CIRCLE_API_KEY=<your_circle_api_key>
CIRCLE_ENTITY_SECRET=<your_entity_secret>   # Never commit! Back up recovery file offline
CIRCLE_WALLET_SET_ID=<your_wallet_set_id>   # Pin after first wallet set is created

# DefiLlama MCP
DEFILLAMA_API_KEY=<your_defillama_api_key>  # If required by MCP

# LLM for natural-language command bar (Phase N) — D-013 ACCEPTED: Anthropic primary, OpenAI fallback
ANTHROPIC_API_KEY=<your_anthropic_api_key>    # Primary
OPENAI_API_KEY=<your_openai_api_key>          # Fallback for availability

# Mantua fee configuration (Phase F) — D-010 ACCEPTED: 10 bps default, MAX_FEE_BPS=25
MANTUA_FEE_BPS=10                             # Default 10 = 0.10%, hard cap 25
MANTUA_FEE_RECIPIENT=<eoa_address>            # EOA at launch (see Risk 1); migrate to multisig per mitigation plan
MANTUA_FEE_ADMIN_KEY=<admin_key_for_fee_updates>  # Server-side only

# Database
DATABASE_URL=<your_postgres_url>
```

---

## 🛠️ Required Skills & SDKs

| Tool                          | Install Command                                                                                                  | Purpose                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Privy React Auth              | `npm i @privy-io/react-auth`                                                                                     | Wallet + auth (embedded + external) |
| Uniswap AI (swap-integration) | `npx skills add uniswap/uniswap-ai --skill swap-integration`                                                     | Swaps & LP via Trading API          |
| Coinbase agentic-wallet       | `npx skills add coinbase/agentic-wallet-skills`                                                                  | Agent wallets & autonomous actions  |
| DefiLlama MCP                 | Follow `https://raw.githubusercontent.com/DefiLlama/defillama-skills/refs/heads/master/defillama-setup/SKILL.md` | Protocol analytics                  |
| viem                          | `npm i viem`                                                                                                     | Web3 clients (wagmi dropped, D-110) |
| Foundry                       | `curl -L https://foundry.paradigm.xyz \| bash && foundryup`                                                      | Hook deployment                     |

---

## 📊 Overall Progress

```
Total Tasks: 144
Completed:   0

[░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%
```

| Phase                                                | Tasks | Done | Progress                                                                                                        |
| ---------------------------------------------------- | ----- | ---- | --------------------------------------------------------------------------------------------------------------- |
| 🧱 Phase 0: Project Bootstrap                        | 8     | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 🎨 Phase D: Design System & UI Shell                 | 8     | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 🛡️ Phase 1: Mainnet Safety                           | 8     | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 🔌 Phase 2: Skill, MCP & Wallet Provider Integration | 16    | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 💱 Phase 3: Swap (Core)                              | 8     | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 💧 Phase 4: Liquidity (Add & Remove)                 | 10    | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 🪝 Phase 5: Hook Integration + AI Security Analysis  | 26    | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 🤖 Phase 6: Agent (Chat + Autonomous)                | 13    | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 📊 Phase 7: DefiLlama Analytics                      | 6     | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 💼 Phase 8: Portfolio Page                           | 7     | 0    | `░░░░░░░░░░` 0%                                                                                                 |
| 💰 Phase F: LP & Mantua Fee                          | 10    | 3    | `███░░░░░░░` 30% (+1 🟡, +6 ⬜ deferred per D-015)                                                              |
| 🗣️ Phase N: Natural Language Command Bar             | 11    | 7    | `███████░░░` 64% (+4 🟡 — clarify multi-turn / param passthrough / OpenAI fallback / E2E)                       |
| ✅ Phase 9: E2E Testing & Launch                     | 13    | 3    | `██░░░░░░░░` 23% (+2 🟡 — browser E2E + fork suites in CI; counsel review owner-gated; ledger `launch-gate.md`) |

---

## ❌ Out of Scope (v2)

| Feature                         | Reason                  |
| ------------------------------- | ----------------------- |
| Voice Commands (Whisper)        | Dropped — text NLP only |
| Mock Tokens (mUSDC, mETH, etc.) | Real tokens only        |
| Prediction Markets              | Not in v2 scope         |
| Vaults                          | Not in v2 scope         |
| Custom Faucet UI                | No faucets on mainnet   |
| Dune MCP                        | Replaced by DefiLlama   |

---

## ⚠️ Open Decisions (Block Later Phases)

| ID    | Decision                                                                         | Blocks  | Status      |
| ----- | -------------------------------------------------------------------------------- | ------- | ----------- |
| D-004 | Hosting target: Vercel (FE) + Railway/Fly (BE) + Neon (DB)                       | Phase 9 | ✅ ACCEPTED |
| D-005 | Privy login methods: email + Google + Apple + passkey + external wallet (no SMS) | Phase 2 | ✅ ACCEPTED |
| D-006 | Privy embedded wallets: `createOnLogin: 'users-without-wallets'`                 | Phase 2 | ✅ ACCEPTED |
| D-007 | WalletConnect enabled (required, not optional)                                   | Phase 2 | ✅ ACCEPTED |
| D-008 | Separate CDP agent wallet (Privy embedded wallet stays user's primary)           | Phase 6 | ✅ ACCEPTED |
| D-009 | Per-wallet daily spending cap: $500 default, tiered raise by account age         | Phase 1 | ✅ ACCEPTED |
| D-010 | Mantua fee: 10 bps default; `MAX_FEE_BPS` capped at 25                           | Phase F | ✅ ACCEPTED |
| D-013 | LLM provider: Anthropic primary, OpenAI fallback                                 | Phase N | ✅ ACCEPTED |
| D-014 | Intent confidence: ≥0.85 execute / 0.65–0.85 clarify / <0.65 reject              | Phase N | ✅ ACCEPTED |
| D-015 | Mantua v2 initial beta has zero fee/legal/spending-cap scope                     | Phase F | ✅ ACCEPTED |

### D-015 Detail (added 2026-04-30)

Mantua v2's initial beta launches with:

- Zero fee collection (no `portionBips` integration, no fee recipient designated, no fee-rate admin endpoint)
- Zero $USD-denominated rails active (no spending-cap UI, no fee-breakdown UI)
- Zero legal / compliance posture beyond standard pre-launch hygiene

This decision consolidates the existing Risk 1 (EOA fee recipient) and Risk 2 (no pre-launch legal review) framings under a single project-level umbrella, and explicitly tags PF-005 → PF-010 as deferred to a Phase F-mainnet sub-track.

**Why this is project-level, not per-ticket:** PF-005 through PF-010 each ship infrastructure that has no purpose without a real revenue stream and a real user base — they're feature-flag-shaped deferrals at the _behavior_ level, not architectural deletions. The code paths can be reactivated by implementing the Trading API `portionBips` integration (PF-007) and designating an EOA recipient (PF-005); the rest follows. No code is deleted by this decision.

**Re-engagement:** PF-005 through PF-010 ship as a coordinated Phase F-mainnet PR set before fee collection turns on, gated on:

- Crypto-counsel review per Risk 2
- Hardware-wallet hygiene + multisig migration plan per Risk 1
- Phase 9 mainnet launch gate (see "Launch-gate framing" in the Phase 9 section)

### Decisions Closed (Reference)

- ~~D-001~~: allowlist removed (public launch)
- ~~D-002~~: all four hooks deploy to Base Mainnet (overrides "Stable Protection only" memo recommendation)
- ~~D-003~~: external audit firm replaced by AI-assisted security analysis methodology — see Phase 5 audit tasks
- ~~D-011~~: fee recipient out of scope — using EOA at launch (see ⚠️ Risk Acknowledgments)
- ~~D-012~~: legal review out of scope at launch (see ⚠️ Risk Acknowledgments)

---

## ⚠️ Risk Acknowledgments

The following risks have been accepted by the project owner and are documented here to ensure they are not forgotten:

### Risk 1: EOA Fee Recipient (was D-011)

**Decision:** Mantua fee revenue collected to an EOA (single private key) at launch, not a multisig.
**Risk surface:** Compromise of the recipient private key results in loss of all accumulated fee revenue with no recovery. Standard wallet hygiene applies (hardware wallet strongly recommended; secure backup of seed phrase; never expose key to development environments).
**Mitigation plan:** Migrate to Safe multisig (2-of-3 minimum, 3-of-5 preferred) when (a) accumulated revenue exceeds $5,000, OR (b) within 6 months of launch, whichever comes first. Track in `docs/architecture.md`.

### Risk 2: No Pre-Launch Legal Review (was D-012)

**Decision:** Mantua fee collection (`portionBips > 0`) ships without a pre-launch crypto-counsel review.
**Risk surface:** Taking fees on mainnet may classify Mantua as a money transmitter, exchange, or broker depending on jurisdiction (US FinCEN/state MTL, EU MiCA, UK FCA, etc.). Operating without proper licensing carries enforcement risk.
**Mitigation plan:** Engage crypto counsel post-launch for a written memo on jurisdictional posture before any expansion of fee scope (variable fee tiers, additional fee streams, fiat ramps). Geofencing of high-risk jurisdictions to be considered if counsel recommends.

---

## 🧱 PHASE 0: Project Bootstrap

> Fresh repo. Per development standards: `.gitignore` first, pinned deps, no secrets.

| ID     | Task                                                                                                                                                     | Status |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P0-001 | Initialize git repo, create `.gitignore` (node_modules, .env, dist, foundry out/, cache/)                                                                | ⬜     |
| P0-002 | Create `docs/` scaffold (tasks/, promptHistory/, architecture.md)                                                                                        | ⬜     |
| P0-003 | Initialize Vite + React 19 + TypeScript (strict mode) + TailwindCSS                                                                                      | ⬜     |
| P0-004 | Configure Shadcn/ui components per design system tokens (colors, spacing, typography from Mantua Prototype)                                              | ⬜     |
| P0-005 | Initialize Express + TypeScript backend, Drizzle ORM, Zod validation                                                                                     | ⬜     |
| P0-006 | Set up PostgreSQL schema: `users`, `user_preferences`, `chat_sessions`, `chat_messages`, `portfolio_transactions`, `positions`, `pools`, `agent_wallets` | ⬜     |
| P0-007 | Initialize Foundry project in `contracts/` for hook work                                                                                                 | ⬜     |
| P0-008 | Set up ESLint + Prettier + Husky pre-commit hooks (lint + typecheck)                                                                                     | ⬜     |

### P0-001 Details

- Pin **all** dependencies to exact versions in `package.json` (no `^` or `~`)
- Verify each package has >1000 weekly downloads before installing
- Template `.env.example` committed; real `.env` ignored

### P0-006 Details: Core Tables

```sql
CREATE TABLE pools (
  id UUID PRIMARY KEY,
  pool_key_hash VARCHAR(66) UNIQUE,
  token0 VARCHAR(42) NOT NULL,
  token1 VARCHAR(42) NOT NULL,
  fee INT NOT NULL,
  tick_spacing INT NOT NULL,
  hook_address VARCHAR(42),
  hook_type VARCHAR(32),  -- 'none' | 'stable' | 'dynamic_fee' | 'rwa_gate' | 'alo'
  created_tx VARCHAR(66),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🛡️ PHASE 1: Mainnet Safety

> ⚠️ This phase did not exist in the v1 build. It must ship before **any** mainnet swap or LP action. These rails are especially important on public launch — there's no allowlist backstop.

| ID     | Task                                                                                                                                                                                                                                  | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P1-001 | Per-wallet daily spending cap: $500/day default at account creation, hard ceiling $50k/day in code (cannot be exceeded by any user action)                                                                                            | ⬜     |
| P1-002 | Account-age tracking: store `first_seen_at` timestamp per wallet on first connection; expose via `getWalletAge(address)` server util                                                                                                  | ⬜     |
| P1-003 | Tiered cap raise UI: Day 0–30 cap locked at $500 (user can lower only); Day 31–90 user can raise to $10k with double-confirmation; Day 91+ user can raise to $50k with double-confirmation; cap reductions never require confirmation | ⬜     |
| P1-004 | Slippage protection: enforce max slippage 1% default, hard cap 5% — reject higher                                                                                                                                                     | ⬜     |
| P1-005 | Transaction confirmation modal mandatory for all on-chain ops (no 1-click execution)                                                                                                                                                  | ⬜     |
| P1-006 | Global kill-switch: env var `MANTUA_KILL_SWITCH=1` disables all write operations                                                                                                                                                      | ⬜     |
| P1-007 | Rate limiting on all API endpoints (per-IP and per-wallet)                                                                                                                                                                            | ⬜     |
| P1-008 | Audit log table: every mainnet tx attempt logged with wallet, action, params, outcome                                                                                                                                                 | ⬜     |

### P1-001 Details: Spending Cap Implementation

- Cap is enforced server-side before any swap/LP transaction is forwarded to the Trading API.
- USD equivalent calculated using DefiLlama prices at time of transaction.
- Cap resets at 00:00 UTC daily.
- Cap is per-wallet, not per-user — agent wallets get their own cap (separate from the user's primary wallet).
- The $50k absolute ceiling is a hard constant; no admin endpoint can raise it. Lifting the ceiling requires a code change + redeploy.

### P1-004 Details: Slippage Enforcement

- User-facing default: 0.5%
- User can raise to 1% with warning
- User can raise to 1–5% with double-confirmation modal
- Above 5%: **hard reject** — do not let user submit
- Uniswap Trading API `autoSlippage` enabled by default; override only on explicit user action

### P1-006 Details: Kill-Switch Semantics

- READ operations (quotes, balances, analytics) remain available
- WRITE operations (swap, add/remove LP, agent actions) return 503 with user-facing message
- Wallet connection remains available
- Intended for incident response, not daily ops

---

## 🎨 PHASE D: Design System & UI Shell

> **Source of truth:** `Mantua Prototype.html` + accompanying README in the design files. The prototype defines the target look, component patterns, and interaction model. This phase extracts that into a reusable system before feature phases start building UIs.
>
> **Order:** Runs in parallel with Phase 0 where possible; must complete before Phase 3 (Swap UI) begins. P0-004 (Shadcn config) depends on PD-002.

| ID     | Task                                                                                                                                                                                                                                                             | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PD-001 | Fetch design file: `Mantua Prototype.html` — prototype is the design spec (no README in package). If non-obvious constraints arise during extraction (responsive breakpoints, accessibility rules, chain-lock behavior), capture them in `docs/design/notes.md`. | ⬜     |
| PD-002 | Extract design tokens from prototype: color palette, typography scale, spacing, radii, shadows — publish to `src/styles/tokens.css` as CSS variables + Tailwind config                                                                                           | ⬜     |
| PD-003 | Map prototype components to Shadcn/ui primitives; document which Shadcn components need custom variants to match the prototype                                                                                                                                   | ⬜     |
| PD-004 | Build app shell: sidebar, top bar, content area — match prototype layout, including responsive collapse behavior                                                                                                                                                 | ⬜     |
| PD-005 | Build shared components used across features: token selector, amount input with MAX button, transaction status toast, confirmation modal, loading skeleton — match prototype                                                                                     | ⬜     |
| PD-006 | Implement Privy login screen styled to match prototype (D-005 login methods wired once decided)                                                                                                                                                                  | ⬜     |
| PD-007 | Document any deviations from the prototype (things we intentionally won't ship as-drawn) in `docs/architecture.md` with rationale                                                                                                                                | ⬜     |
| PD-008 | Visual QA: side-by-side comparison of each built page against the prototype; capture screenshots in `docs/design/`                                                                                                                                               | ⬜     |

### Design Phase Rules

1. **The prototype is the spec.** If the prototype and this task list conflict on UI details, the prototype wins — flag the conflict and update the task list.
2. **No custom CSS without a token.** Every color, spacing value, and font size traces back to a token published in PD-002. Ad-hoc hex codes or `px` values are a lint failure.
3. **Dark/light mode behavior follows the prototype.** If the prototype is dark-only, ship dark-only — don't speculatively add a light theme.
4. **Old v1 palette is dead.** The teal `#14b8a6` accent from v1 Portfolio redesign does not carry over unless the new prototype happens to use it.
5. **Accessibility baseline:** WCAG 2.1 AA — focus states, contrast ratios, keyboard nav — even if the prototype doesn't show them explicitly.

### Feature-Phase Design Handoff

Each feature phase (Swap, Liquidity, Agent, Portfolio) must reference the relevant prototype screens before implementation:

- Phase 3 (Swap) → prototype swap screen + confirmation flow
- Phase 4 (Liquidity) → prototype liquidity list + add/remove modals
- Phase 6 (Agent) → prototype agent mode selection + chat interface
- Phase 8 (Portfolio) → prototype portfolio layout (replaces old Hyperliquid-inspired three-column design from v1)

---

## 🔌 PHASE 2: Skill, MCP & Wallet Provider Integration

> Install the external tools and wallet provider. Verify each works end-to-end in isolation before building features on top.

| ID     | Task                                                                                                                                                                                                                               | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P2-001 | Run `npx skills add uniswap/uniswap-ai --skill swap-integration` — verify installed                                                                                                                                                | ⬜     |
| P2-002 | Obtain Uniswap Trading API key, add to `.env`, test `POST /v1/quote` with cURL on Base Mainnet                                                                                                                                     | ⬜     |
| P2-003 | Run `npx skills add coinbase/agentic-wallet-skills` — verify installed                                                                                                                                                             | ⬜     |
| P2-004 | Obtain CDP credentials, create test agent wallet on Base Mainnet, verify on BaseScan                                                                                                                                               | ⬜     |
| P2-005 | Read and follow `https://raw.githubusercontent.com/DefiLlama/defillama-skills/refs/heads/master/defillama-setup/SKILL.md`                                                                                                          | ⬜     |
| P2-006 | Configure DefiLlama MCP in `claude_desktop_config.json` (or project MCP config)                                                                                                                                                    | ⬜     |
| P2-007 | Verify DefiLlama MCP responds: query "TVL of Uniswap on Base" and confirm result                                                                                                                                                   | ⬜     |
| P2-008 | Privy: create app at `dashboard.privy.io`, restrict supported chains to Base Mainnet (8453) only                                                                                                                                   | ⬜     |
| P2-009 | Install `@privy-io/react-auth` (pin exact version), add `VITE_PRIVY_APP_ID` + `PRIVY_APP_SECRET` to `.env`                                                                                                                         | ⬜     |
| P2-010 | Configure Privy per accepted decisions: `loginMethods: ['email', 'google', 'apple', 'passkey', 'wallet']` (D-005); `embeddedWallets.createOnLogin: 'users-without-wallets'` (D-006); WalletConnect enabled with project ID (D-007) | ⬜     |
| P2-011 | Wrap app root in `PrivyProvider` with configured `loginMethods`, `embeddedWallets`, `defaultChain: base`, `supportedChains: [base]`                                                                                                | ⬜     |
| P2-012 | Build login UI: `usePrivy().login()` trigger, loading state on `ready`, logged-in state via `authenticated`                                                                                                                        | ⬜     |
| P2-013 | Wire Privy → viem bridge (no wagmi, D-110): use `useWallets()` to get active wallet's EIP-1193 provider for viem clients — shipped in `client/src/lib/privy/wallet-client.ts`                                                      | ⬜     |
| P2-014 | Server-side: verify Privy access tokens on protected API routes using `@privy-io/server-auth`                                                                                                                                      | ⬜     |
| P2-015 | HTTPS enforcement: dev and prod must serve over HTTPS (Privy's Web Crypto API fails silently on HTTP)                                                                                                                              | ⬜     |
| P2-016 | Integration smoke test: Privy login → embedded wallet provisioned → quote fetched → DefiLlama query returns. All four green.                                                                                                       | ⬜     |

### P2-011 Details: PrivyProvider Configuration (accepted decisions baked in)

```tsx
import { PrivyProvider } from "@privy-io/react-auth";
import { base } from "viem/chains";

<PrivyProvider
  appId={import.meta.env.VITE_PRIVY_APP_ID}
  config={{
    appearance: { theme: "dark", accentColor: /* from design tokens PD-002 */ },
    loginMethods: ["email", "google", "apple", "passkey", "wallet"],  // D-005
    embeddedWallets: {
      createOnLogin: "users-without-wallets",  // D-006
      requireUserPasswordOnCreate: false,
    },
    walletConnectCloudProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,  // D-007
    defaultChain: base,
    supportedChains: [base],  // Base Mainnet ONLY — reject any other chain
  }}
>
  {children}
</PrivyProvider>
```

### P2-013 Details: Privy → viem Bridge

```tsx
import { useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom } from "viem";
import { base } from "viem/chains";

const { wallets } = useWallets();
const activeWallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
const provider = await activeWallet.getEthereumProvider();
const walletClient = createWalletClient({
  chain: base,
  transport: custom(provider),
});
// walletClient is now usable with Uniswap Trading API swap calldata
```

### P2-015 Details: HTTPS Requirement

Privy's key sharding uses the Web Crypto API, which only works in secure contexts. Plain HTTP (other than `localhost`) fails silently with cryptic errors. Dev setup must use `vite --https` or a local cert; staging/prod require valid TLS.

---

## 💱 PHASE 3: Swap (Core)

> All swaps route through the Uniswap Trading API. No direct PoolManager calls for standard swaps.

| ID     | Task                                                                                                   | Status |
| ------ | ------------------------------------------------------------------------------------------------------ | ------ |
| P3-001 | Build swap UI: token-in selector, amount input, token-out selector, quote display, confirm button      | ⬜     |
| P3-002 | Wire `POST /v1/quote` to Trading API with Base Mainnet chainId (8453)                                  | ⬜     |
| P3-003 | Display quote details: expected output, price impact, gas estimate, route summary                      | ⬜     |
| P3-004 | Implement Permit2 approval flow (EIP-712 signature, no separate approval tx)                           | ⬜     |
| P3-005 | Execute swap: user signs Permit2 + submits calldata via viem → wait for receipt                        | ⬜     |
| P3-006 | On success: show BaseScan link, insert row into `portfolio_transactions`                               | ⬜     |
| P3-007 | Error handling: insufficient balance, quote expired, spending cap exceeded, kill-switch, user reject   | ⬜     |
| P3-008 | E2E test: 6 token-pair combinations (ETH↔USDC, ETH↔cbBTC, ETH↔EURC, USDC↔cbBTC, USDC↔EURC, cbBTC↔EURC) | ⬜     |

### P3-004 Details: Permit2 Flow

Use Uniswap Trading API response — it returns permit data when needed. Sign with `signTypedData`, pass signature back on `/v1/swap` call. Single user interaction for approval + swap.

---

## 💧 PHASE 4: Liquidity (Add & Remove)

> LP operations via Trading API where supported; fall back to `@uniswap/v4-sdk` + PositionManager for hooked pools.

| ID     | Task                                                                                       | Status |
| ------ | ------------------------------------------------------------------------------------------ | ------ |
| P4-001 | Liquidity landing page: list of pools with TVL, volume 24h, fees 24h (from DefiLlama)      | ⬜     |
| P4-002 | Pool detail page: OHLC chart (lightweight-charts) with 1D/7D/30D via CoinGecko             | ⬜     |
| P4-003 | Pool creation flow: select token0, token1, fee tier, tick spacing, optional hook           | ⬜     |
| P4-004 | Add Liquidity modal: amounts, price range (concentrated), slippage                         | ⬜     |
| P4-005 | Execute add liquidity → BaseScan link → insert `positions` + `portfolio_transactions` rows | ⬜     |
| P4-006 | Remove Liquidity button on pool detail (enabled only if user has position)                 | ⬜     |
| P4-007 | Remove Liquidity modal: percentage slider (25/50/75/100), preview amounts                  | ⬜     |
| P4-008 | Execute remove → update position status (`closed` if 100%) → BaseScan link                 | ⬜     |
| P4-009 | Position tracking: use PositionManager events + subgraph for discovery (per v4-sdk guide)  | ⬜     |
| P4-010 | E2E test: create pool → add LP → remove 50% → remove 100% → verify all on BaseScan         | ⬜     |

---

## 🪝 PHASE 5: Hook Integration (4 Hooks)

> Each hook is paired with an AI-assisted security analysis pass before being wired into pool creation. The pre-launch deployments (used to verify bytecode + permission flags during development) are superseded; **Base Mainnet (8453) deployment is pending** and is a launch-gating step (see Phase 9 and `docs/security/hook-deployments.md`).

### Hook Address Registry

| Hook              | Network      | Address                                                 | Status                             |
| ----------------- | ------------ | ------------------------------------------------------- | ---------------------------------- |
| Stable Protection | Base Mainnet | pending — env override `STABLE_PROTECTION_HOOK_ADDRESS` | ⬜ Deployment pending              |
| DynamicFee        | Base Mainnet | pending — env override `DYNAMIC_FEE_HOOK_ADDRESS`       | ⬜ Deployment pending (TWAP build) |
| RWAGate           | Base Mainnet | pending                                                 | ⬜ Deployment pending              |
| ALO               | Base Mainnet | pending                                                 | ⬜ Deployment pending              |

> Bytecode and permission flags verified against on-chain state by `npm run verify:hooks` — see `docs/security/hook-deployments.md` for the latest report.

### Stable Protection Hook

| ID     | Task                                                                                                                                 | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| P5-001 | Verify Stable Protection deployment via `npm run verify:hooks` (done on the pre-launch build; re-run against Base Mainnet at deploy) | ✅     |
| P5-002 | Valid pair gating: USDC/EURC (USDT pairs deferred until USDT is added to the supported token registry)                               | ✅     |
| P5-003 | UI: 5-zone peg status indicator (🟢 HEALTHY / 🟡 MINOR / 🟠 MODERATE / 🔴 SEVERE / ⛔ CRITICAL)                                      | ⬜     |
| P5-004 | Warn user when zone ≥ MODERATE; block swap when zone = CRITICAL with clear message                                                   | ⬜     |
| P5-005 | Create pool with Stable Protection: USDC/EURC pool via `@uniswap/v4-sdk` + PositionManager                                           | ⬜     |
| P5-006 | E2E: swap within pool with peg healthy; verify fee applied per zone                                                                  | ⬜     |

### DynamicFee Hook

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P5-007 | Verify DynamicFee deployment via `npm run verify:hooks` (done on the pre-launch build; re-run against Base Mainnet at deploy)                                                                                                                                                                                                                                                                                                                                                                                                 | ✅     |
| P5-008 | Volatility measurement source for DynamicFee: **pool-history TWAP** (decision 2026-04-28; Chainlink dropped from v2 scope). TWAP build ([`62710d6`](https://github.com/DelleonMcglone/dynamic-fee/commit/62710d6d9b403557b073a702b5546bc10e75c0c6)) verified on the pre-launch deployment (2026-04-29); on-chain selector probe confirmed the new `configurePool(bytes32,uint64,uint24,uint24,int8,uint256[4])` signature is present and the legacy Chainlink selectors are gone. Base Mainnet redeploy uses the same commit. | ✅     |
| P5-009 | UI: display current dynamic fee in swap modal before confirmation                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ⬜     |
| P5-010 | E2E: swap on a DynamicFee-hooked pool; verify fee adjusts under volatility scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                          | ⬜     |

### RWAGate Hook

| ID     | Task                                                                                                                                                                                                                              | Status |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P5-011 | Verify RWAGate deployment (pre-launch build verified; re-run against Base Mainnet at deploy); compliance gating via **KYC list** (decision 2026-04-28) — admin-managed allowlist of compliant wallets in the `ComplianceRegistry` | 🟡     |
| P5-012 | UI: RWA pool access gated — show "Verification required" state for non-compliant wallets                                                                                                                                          | ⬜     |
| P5-013 | E2E: attempt RWA pool interaction with non-compliant wallet (rejected) and compliant wallet (accepted)                                                                                                                            | ⬜     |

### ALO (Async Limit Order) Hook

| ID     | Task                                                                                          | Status |
| ------ | --------------------------------------------------------------------------------------------- | ------ |
| P5-014 | Verify ALO deployment via `npm run verify:hooks` (pre-launch build; re-run at mainnet deploy) | ✅     |
| P5-015 | UI: limit order entry form (price, amount, expiry) + pending orders list                      | ⬜     |
| P5-016 | E2E: place limit order, verify async execution at target price, verify expiry handling        | ⬜     |

### Dynamic Market Hook & Fee Model (task 049, D-105)

> Spec (authoritative): regular season 0%; playoffs dynamic 0.10%–0.70%
> (immutable 0.70% ceiling) from liquidity, volatility, trading activity
> and market uncertainty; `Fee = C × fee_rate × p × (1 − p)`, peaking at
> p = 0.50. Detail: `docs/tasks/049-dynamic-market-fee-model.md`.

| ID    | Task                                                                                                                                                                                                                                                                                                                              | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| H-001 | Fee = C × fee_rate × p × (1 − p) exactly (`MarketFeeFormula.sol`, shared vectors)                                                                                                                                                                                                                                                 | ✅     |
| H-002 | 0.70% ceiling as an immutable constant, no admin path (`RiskPolicy.MAX_RATE`)                                                                                                                                                                                                                                                     | ✅     |
| H-003 | 0.10%–0.70% dynamic range from four bounded drivers (`MarketFeeCalculator.rate`)                                                                                                                                                                                                                                                  | ✅     |
| H-004 | Season switch: per-pool `playoffs` at registration from the league calendar (D-105)                                                                                                                                                                                                                                               | ✅     |
| H-005 | p from pool state, both token orderings; peak-at-0.50 / decline proven                                                                                                                                                                                                                                                            | ✅     |
| H-006 | Unit + property tests: ceiling, 0% regular season, fee(0.5) ≥ fee(p), monotone                                                                                                                                                                                                                                                    | ✅     |
| H-007 | Fuzz + invariant harnesses, 100k-call sweep (`DynamicMarketInvariant.t.sol`)                                                                                                                                                                                                                                                      | ✅     |
| H-008 | AI-assisted security pass (`docs/security/dynamic-market-fee-review.md`)                                                                                                                                                                                                                                                          | ✅     |
| H-009 | Deploy to Base Mainnet + verify — **owner-gated** (funded keystore, BaseScan key, D-112). Prep done 2026-09-12: full suite green locally against the live fork (238/0/8), no-key fork simulation of the deploy ran (bits `0x28C0`, ≈8.16M gas), `deploy/dynamic-market/deploy.sh` wraps preflight → dry run → confirm → broadcast | ⬜     |
| H-010 | Pool creation passes `playoffs` to `registerPool` (`markets-onchain.ts`)                                                                                                                                                                                                                                                          | ✅     |
| H-011 | Fee telemetry per trade (`market_fills` fee columns, migration 0019, activity feed)                                                                                                                                                                                                                                               | ✅     |
| H-012 | Fee quote: hook `quoteFee` → `BuiltMarketTrade.fee` → Position / fee / Total in the UI                                                                                                                                                                                                                                            | ✅     |
| H-013 | Live scenario matrix (`FeeScenarios.t.sol`; on-chain fee proof in `FullLifecycle.t.sol`)                                                                                                                                                                                                                                          | ✅     |
| H-014 | Docs: `docs/fee-model.md`, `docs/architecture.md`, spec §16–§18/§27/§29/§34 updated                                                                                                                                                                                                                                               | ✅     |
| H-015 | Probability sweep 0/10/25/50/75/90/100 %, floor and ceiling reached, size extremes                                                                                                                                                                                                                                                | ✅     |
| H-016 | Rounding / overflow / precision (`MarketFeeFormula.t.sol`)                                                                                                                                                                                                                                                                        | ✅     |
| H-017 | Manipulation resistance (`FeeManipulation.t.sol`)                                                                                                                                                                                                                                                                                 | ✅     |

### Core Trading UX — consumer layer (Phase 6 📱, task 050)

> Owner directive 2026-09-12. Feels like a modern sports app; complexity
> underneath; the conversational dock stays the primary surface. Detail and
> the reconciled evidence table: `docs/tasks/050-core-trading-ux.md`.

| ID    | Task                                                                                | Status |
| ----- | ----------------------------------------------------------------------------------- | ------ |
| T-001 | Market discovery home; a new sport is one catalog row, no navigation layer          | ✅     |
| T-002 | ≤3-tap trade flow (`trade-ticket-core.ts`, tap budget asserted)                     | ✅     |
| T-003 | Instant buy and sell before or during the event                                     | ✅     |
| T-004 | Clean sports-app interface, no DeFi terminology in the primary UX                   | ✅     |
| T-005 | Gasless UX surface (`chainless-copy.test.ts`)                                       | ✅     |
| T-006 | Explicit "Trade executed" state (`TicketExecuted`)                                  | ✅     |
| T-007 | Real-time position and balance updates (`use-live-balance.ts`)                      | ✅     |
| T-008 | Transparent fee display identical to the hook quote; ceiling guard; $0.35 / $0.18   | ✅     |
| T-009 | Fee-structure explainer (`FeeExplainer`)                                            | ✅     |
| T-010 | Market page simple layer (`MarketSummary`); deeper data behind "More"               | ✅     |
| T-011 | ≤3-tap exit / profit-lock (Close → Confirm)                                         | ✅     |
| T-012 | Error copy for every state (`trade-errors.ts`)                                      | ✅     |
| T-013 | Onboarding: bank-connect + deposit inside the ticket, skippable (`TicketFunding`)   | ✅     |
| T-014 | E2E loop over the shipped modules (`consumer-loop.e2e.test.ts`); on-chain leg D-112 | ✅     |
| T-015 | Universal command bar preserved as the primary surface                              | ✅     |
| T-016 | Contextual quick actions (`lib/quick-actions.ts`, `QuickActions`)                   | ✅     |
| T-017 | Natural-language intent switching incl. team hints (`team-select.ts`)               | ✅     |
| T-018 | Discovery filters (`discovery.ts`, `GET /api/markets/discover`)                     | ✅     |
| T-019 | Natural-language discovery (`discover` intent)                                      | ✅     |
| T-020 | Never requires a market id or address                                               | ✅     |
| T-021 | Market-implied vs model probability labelled everywhere (`ProbabilityTag`)          | ✅     |
| T-022 | No prediction presented as certainty (`PredictionNote`)                             | ✅     |
| T-023 | Freshness stamp on every live-data surface (`Freshness`)                            | ✅     |

### AI-Assisted Security Analysis (replaces external audit per project decision)

> Methodology: Trail of Bits Claude Code skills via `https://github.com/DelleonMcglone/AI-assisted-security-analysis`. Install plugin marketplace and run targeted analyses against each hook's source before wiring into pool creation flow. Findings logged in `docs/security/` with status (fix / accept / mitigate). All analyses must be re-run after any contract change.

| ID     | Task                                                                                                                                                                                              | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P5-017 | Install Trail of Bits skills marketplace: `/plugin marketplace add DelleonMcglone/AI-assisted-security-analysis`                                                                                  | ⬜     |
| P5-018 | Run `audit-context-building` against each of the 4 hook contracts; capture architectural notes in `docs/security/`                                                                                | ⬜     |
| P5-019 | Run `entry-point-analyzer` to enumerate state-changing entry points for each hook                                                                                                                 | ⬜     |
| P5-020 | Run `building-secure-contracts` vulnerability scanners on all 4 hooks                                                                                                                             | ⬜     |
| P5-021 | Run `sharp-edges` (footgun detection) and `insecure-defaults` plugins on all hook configs                                                                                                         | ⬜     |
| P5-022 | Run `static-analysis` (CodeQL + Semgrep) on hook contracts; address all HIGH severity findings                                                                                                    | ⬜     |
| P5-023 | Run `spec-to-code-compliance` for Stable Protection (peg zones), DynamicFee (volatility math), RWAGate (gating logic), ALO (order matching) — verify each implementation matches its written spec | ⬜     |
| P5-024 | Run `property-based-testing` plugin to generate fuzz harnesses for hook invariants (e.g. "fee never exceeds MAX_FEE_BPS", "RWAGate never lets non-compliant addresses transact")                  | ⬜     |
| P5-025 | Document all findings in `docs/security/findings.md` with: severity, status (fix/accept/mitigate), and link to fix commit if fixed                                                                | ⬜     |
| P5-026 | Re-run all analyses after fixes are merged; produce final `docs/security/sign-off.md` listing residual accepted risks                                                                             | ⬜     |

### Security Phase Rules

1. **Hooks cannot be wired into pool creation UI until P5-026 is signed off** — no pool creation tasks (P5-005, plus DynamicFee/RWAGate/ALO equivalents) ship before security sign-off.
2. **AI-assisted analysis is not equivalent to a paid third-party audit.** Findings depend on prompt quality and tool coverage. The `docs/security/sign-off.md` file must explicitly acknowledge this limitation.
3. **Any contract change post-sign-off triggers a re-run** of P5-017 through P5-026. No exceptions.
4. **HIGH severity findings block ship.** MEDIUM findings require written acceptance with rationale. LOW findings can be tracked as backlog.

---

## 💰 PHASE F: LP & Mantua Fee

> Mantua v2 is revenue-generating. Fees have two components: (1) the Uniswap v4 LP fee tier selected at pool creation, which goes to LPs and the Uniswap protocol, and (2) a Mantua service fee layered on top, routed via the Uniswap Trading API's portion fee parameters.

### LP Fee Tier (pool creation)

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PF-001 | Pool creation UI exposes fee tier selector: 0.01%, 0.05%, 0.30%, 1.00% (v4 standard tiers). **Already shipped** in commit `8f36c91` (Phase 4b: Pool creation P4-003) — `client/src/features/liquidity/FeeTierPicker.tsx` (2×2 grid of buttons with percentage labels, pair-type hints, and tick-spacing display) wired into `client/src/features/liquidity/PoolCreateForm.tsx:96`. Server-side, `server/src/routes/pool-create.ts:30` requires `fee` in the request body and validates against the standard tiers via `isFeeTier` from `server/src/lib/v4-contracts.ts:134`.                                                                                                                                                                       | ✅     |
| PF-002 | Default fee tier per pair type: 0.01% for stablecoin pairs, 0.05% for ETH/stable, 0.30% for volatile, 1.00% for exotic. **Already shipped** in commit `8f36c91` — `client/src/features/liquidity/fee-tiers.ts:DEFAULT_FEE_TIER_FOR_PAIR(aIsStable, bIsStable)` returns 100 (both stables), 500 (one stable), 3000 (neither stable), used in `PoolCreateForm.tsx:30`. **Note:** the function never auto-defaults to 1.00% — for the supported token set (ETH/USDC/EURC/cbBTC), all 6 pair combinations map cleanly to 0.01% / 0.05% / 0.30% defaults; cbBTC + stable currently classified as 0.05% (defensible for the beta; revisit per-pair-type bucketing as volume data accumulates). The 1.00% tier remains user-pickable via `FeeTierPicker`. | ✅     |
| PF-003 | Display selected fee tier in Liquidity page pool list and pool detail. **Inline rendering already exists**: `LiquidityListPage.tsx:73` renders `{pool.feeTier}` as inline text on DefiLlama-sourced pools, `PoolDetailPage.tsx:50-51` renders in a font-mono span, `AssetsCard.tsx:278` renders in position rows. **Pill-badge polish deferred** — gated on TD-004 design-source delivery (the Mantua design-source UI port may specify a different fee-tier display pattern; landing inline polish now risks contradicting that). The AssetsCard's fee column is currently hardcoded mock data (`AssetsCard.tsx:40-43`) — wiring it to real position data is part of the same Phase 8 UI port that will close this 🟡.                            | 🟡     |
| PF-004 | Enforce valid tick spacing for each fee tier (v4 requires matching `tickSpacing`). **Already shipped, structurally stronger than spec.** Commit `8f36c91` introduced `TICK_SPACING_BY_FEE` (lookup table at `server/src/lib/v4-contracts.ts:127`) and `buildPoolKey` (`server/src/lib/pool-key.ts:42` — auto-derives `tickSpacing` from `fee`). The pool-create route never accepts a separate `tickSpacing` param, so feeTier↔tickSpacing mismatch is unrepresentable at the type level — no runtime validation needed because the wire format makes the bug impossible.                                                                                                                                                                          | ✅     |

### Mantua Service Fee (on swaps)

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                             | Status |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PF-005 | Generate or designate EOA fee recipient address; secure private key in hardware wallet; document address in `docs/architecture.md`. **DEFERRED — Phase F-mainnet sub-track per D-015.** No service-fee EOA recipient designated for the initial beta (fee collection is off). Re-engage when fees turn on, gated on Risk 1's hardware-wallet hygiene + multisig migration plan.                                                  | ⬜     |
| PF-006 | Store fee config in `fee_config` table: `rate_bps`, `recipient`, `effective_from`, `effective_to`. **DEFERRED — Phase F-mainnet sub-track per D-015.** `fee_config` table not created in the initial beta (gates a feature that doesn't run). Re-engage when fees turn on.                                                                                                                                                       | ⬜     |
| PF-007 | Integrate Trading API `portionBips` + `portionRecipient` fields into quote + swap calls (default `MANTUA_FEE_BPS=10`). **DEFERRED — Phase F-mainnet sub-track per D-015.** Trading API integration in `server/src/lib/uniswap.ts` does not pass `portionBips`/`portionRecipient`; the env-level `MANTUA_FEE_BPS=10` default in `server/src/env.ts:51` is unused at runtime until this ticket lands. Re-engage when fees turn on. | ⬜     |
| PF-008 | UI: display fee breakdown in swap confirmation ("Uniswap LP fee: X bps, Mantua fee: Y bps, You pay: Z"). **DEFERRED — Phase F-mainnet sub-track per D-015.** No fee breakdown UI for the initial beta (avoids "Mantua fee: 0 bps" visual noise when no fee is collected). Re-engage when fees turn on, alongside the Phase 8 Swap-confirmation port (TD-004).                                                                    | ⬜     |
| PF-009 | Admin endpoint to update fee rate (signed by fee-admin key, logged to audit table); enforce `rate_bps ≤ 25` server-side. **DEFERRED — Phase F-mainnet sub-track per D-015.** Admin functionality for an inactive feature not built in the initial beta. Re-engage when fees turn on.                                                                                                                                             | ⬜     |
| PF-010 | Track accumulated fee revenue (read EOA balance) — surface threshold alerts at $1k, $5k, $10k to drive multisig migration timing. **DEFERRED — Phase F-mainnet sub-track per D-015.** Revenue tracking deferred — no revenue to track while fees are off. Re-engage when fees turn on, alongside Risk 1's multisig-migration trigger ($5k accumulated).                                                                          | ⬜     |

### PF-007 Details: Trading API Fee Integration

Uniswap Trading API supports the `portionBips` and `portionRecipient` parameters on `/v1/quote` and `/v1/swap`. The portion fee is deducted from the user's output token and sent to the recipient atomically. Reference: `https://docs.uniswap.org/api/trading/overview`

```typescript
const quote = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", {
  method: "POST",
  headers: { "x-api-key": process.env.UNISWAP_TRADING_API_KEY },
  body: JSON.stringify({
    type: "EXACT_INPUT",
    tokenInChainId: 8453,
    tokenOutChainId: 8453,
    tokenIn,
    tokenOut,
    amount,
    swapper: userAddress,
    portionBips: MANTUA_FEE_BPS, // 10 = 0.10% default
    portionRecipient: MANTUA_FEE_RECIPIENT, // EOA at launch (see Risk 1)
  }),
});
```

### Fee Safety Rules

1. Fee rate is capped in code — a misconfigured admin call cannot set rate above `MAX_FEE_BPS = 25` (0.25%). This is a hard constant. Lifting requires code change + redeploy.
2. Fee recipient cannot be changed by the agent, ever — only by signed admin action with audit log entry.
3. Fee collection can be disabled by the kill-switch (P1-006): when `MANTUA_KILL_SWITCH=1`, fee is set to 0 bps but swaps still work. Users are never blocked from transacting.
4. EOA recipient hygiene (per Risk 1): hardware wallet for the private key, no exposure to dev environments, written backup of seed phrase stored separately from any digital location, migration to multisig planned per the mitigation in the Risk Acknowledgments section.

---

## 🤖 PHASE 6: Agent (Chat + Autonomous)

> Agent uses `coinbase/agentic-wallet-skills`. The user's Privy embedded wallet stays the user's primary; the agent uses a SEPARATE CDP wallet the user funds explicitly with a budget (D-008 ACCEPTED, locked in `docs/architecture.md` → "CDP agent wallet (Phase 6)" → "Wallet boundary"). Agent never gets signing rights over the Privy wallet.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P6-000 | Architecture confirmation (D-008 ACCEPTED): user's Privy embedded wallet stays the user's primary; agent uses a SEPARATE CDP wallet that the user funds explicitly with a budget. Agent never gets signing rights over the Privy wallet. Locked into `docs/architecture.md` → "CDP agent wallet (Phase 6)" → "Wallet boundary" (2026-04-30).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | ✅     |
| P6-001 | Agent mode selection screen: Chat vs Autonomous. Ported from `~/Downloads/mantua-ai/project/src/chat.jsx` (`step === 'mode'`) into `client/src/features/agent/AgentPanel.tsx`; both Chat (💬) and Autonomous (🤖) cards route to their respective steps; autonomous-step body remains a placeholder until P6-009 → P6-012 land the conversational flow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅     |
| P6-002 | Chat mode: 6 action cards UI (Create Wallet, Send, Swap, Liquidity, Query, **Fund Agent Wallet**) per design source `~/Downloads/mantua-ai/project/src/chat.jsx` line 22 — the original roadmap text said "Portfolio" but the design uses "Fund Agent Wallet"; design wins. Cards live in `client/src/features/agent/AgentPanel.tsx` (`step === 'chat'`, `CHAT_ACTIONS`) as a 3-column inert grid; handlers light up under P6-003 → P6-007. **Note:** Portfolio Summary (P6-008) has no chat-grid surface as a result and needs a separate placement decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅     |
| P6-003 | Action: Create & Manage Agent Wallet — **server-side shipped**, now via Circle Developer-Controlled Wallets (D-110 superseded the original bare-`@coinbase/cdp-sdk` implementation): `server/src/lib/circle/client.ts` + `server/src/lib/agent-wallet.ts`; routes `POST /api/agent/wallet` (idempotent provision) and `GET /api/agent/wallet` in `server/src/routes/agent-wallets.ts`; SCA wallet provisioned per user into the wallet set, row persisted in the existing `agent_wallets` Drizzle table; `MANTUA_NETWORK=mainnet` (the default) puts the agent on Base Mainnet (matching Phase 5). Provider rationale captured in `docs/architecture.md` → "Circle agent wallet (Phase 6)" → "Implementation path". Chat-mode wallet card fires the API and shows the resulting address inline. **"Fund agent" UI deferred** — design source has no Fund sub-flow (TD-004); integration test deferred (TD-003). Roadmap status 🟡 until both close.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🟡     |
| P6-004 | Action: Send Tokens (ETH, cbBTC, USDC, EURC) with BaseScan confirmation. **Server-side shipped** via `server/src/lib/agent-send.ts:sendFromAgentWallet` and `POST /api/agent/send` in `server/src/routes/agent-send.ts`. Flow: lookup agent wallet by privyUserId → resolve token via `getToken(symbol)` → `parseUnits(amount, decimals)` → USD value via `tokenAmountUsd` → `checkSpendingCap(agentAddress, usdValue)` (P1-001 / P6-011 rail) → native-coin sends are rejected for now (`token.native` check) — ERC-20 `transfer(address,uint256)` executed by the agent's Circle Developer-Controlled Wallet via `executeAgentAbiCall` (executed and gas-sponsored by Circle; D-110 superseded the original CDP `account.useNetwork(...).transfer` narrative) → `recordSpending` → BaseScan `explorerUrl`. Network is `base` (Base Mainnet). Errors map to 404 `AGENT_WALLET_NOT_FOUND`, 403 `spending_cap_exceeded` / `spending_cap_hard_ceiling`, 503 `CIRCLE_UNAVAILABLE`, 502 `UPSTREAM_FAILURE`. **Send-flow UI deferred** — design source has no Send sub-flow (TD-004 expanded); the Chat-mode "Send Tokens" card stays inert. Roadmap status 🟡 until UI lands.                                                                                                                                                                                                                                                                                                                                                                                                           | 🟡     |
| P6-005 | Action: Swap Tokens — reuse the Phase 3 Uniswap primitives. **Server-side shipped** via `server/src/lib/agent-swap.ts:swapFromAgentWallet` and `POST /api/agent/swap` in `server/src/routes/agent-swap.ts`. Single server-side orchestration (no client round-trips, since the agent has no human in the loop): lookup agent wallet → cap check → live on-chain v4 quote on the no-hook pool (`quoteExactInputV4`, tier auto-resolved) → `buildPoolSwapTestCalldata` → two gas-sponsored Circle DCW transactions via `executeAgentAbiCall` / `executeAgentCalldata` — an exact-amount `approve(address,uint256)` to the router's approval target, then the swap calldata (D-110 superseded the original CDP `signTypedData` / `sendTransaction` narrative — the agent wallet executes on-chain; nothing is client-signed) → record spending + insert `portfolio_transactions` row mirroring `/api/swap/record`. Errors map to 404 `AGENT_WALLET_NOT_FOUND`, 403 `spending_cap_*`, 503 `CIRCLE_UNAVAILABLE`, 502 `UPSTREAM_FAILURE` (Trading API or Circle). **Swap-flow UI deferred** — same design-source gap as the rest of the action cards (TD-004 expanded).                                                                                                                                                                                                                                                                                                                                                                                                                   | 🟡     |
| P6-006 | Action: Add/Remove Liquidity — reuse the Phase 4 v4 primitives. **Server-side shipped** via `server/src/lib/agent-liquidity.ts` and `POST /api/agent/liquidity/{add,remove}` in `server/src/routes/agent-liquidity.ts`. **Add path:** lookup wallet → cap check → ensure the two Permit2 approvals by executing them through the Circle wallet — `approve(PERMIT2, MAX_UINT256)` on each non-native token and the `MAX_UINT160/48` Permit2 allowance, each gated by an on-chain `allowance` read that short-circuits when already approved (approvals bounded to the requested trade size with a one-hour Permit2 expiry by PR #18) → `readSlot0` for `sqrtPriceX96` → `buildAddLiquidityCalldata` → `executeAgentCalldata` (modifyLiquidities via the Circle wallet; D-110 superseded the original CDP `signTypedData(PermitBatch)` narrative) → `waitForTransactionReceipt` → extract `tokenId` from the PositionManager `Transfer(0x0, agent, tokenId)` log → `recordSpending` + insert `positions` row mirroring `/api/liquidity/add/record`. **Remove path:** lookup wallet + position (must belong to caller) → `readSlot0` → `buildRemoveLiquidityCalldata` → Circle execute via `executeAgentCalldata` (no Permit2 needed — the agent owns the position NFT; remove burns liquidity on full exits) → mark `closed` or decrement liquidity. Errors map to 404 `AGENT_WALLET_NOT_FOUND`, 403 `spending_cap_*`, 503 `CIRCLE_UNAVAILABLE`, 502 `UPSTREAM_FAILURE` (Circle/RPC, pool-not-init, etc.). **Liquidity-flow UI deferred** — same design-source gap (TD-004 expanded). | 🟡     |
| P6-007 | Action: Query On-Chain Data — route to DefiLlama. Server-side shipped via `GET /api/agent/query?type=...` in `server/src/routes/agent-query.ts`. Thin authenticated wrapper around the existing `server/src/lib/defillama.ts` (`listBasePools`, `getBasePool`, `poolChart`). Three query types: `pools` (list Base v3/v4 Uniswap pools), `pool` (single pool by id), `chart` (historical TVL + APY, days configurable). Phase 7 (P7-001 → P7-006) will widen the query surface (token prices, protocol TVL, top yields, etc.) under the same `/api/agent/query/...` prefix. **DefiLlama MCP** integration referenced in the original ticket text is also Phase 7 — current implementation hits DefiLlama's open `yields.llama.fi` HTTP API directly. UI deferred per TD-004.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🟡     |
| P6-008 | Action: Portfolio Summary — show agent wallet balances + tx history. Server-side shipped via `GET /api/agent/portfolio` in `server/src/routes/agent-portfolio.ts` and `server/src/lib/agent-portfolio.ts:getAgentPortfolio`. Reads balances live via viem (native ETH via `getBalance`, ERC-20s via `balanceOf` against `baseRpcClient`); USD values via `tokenAmountUsd` (CoinGecko, 60s cached); transactions filtered from `portfolio_transactions` by `walletAddress = agentAddress` ordered by `createdAt` desc, default limit 50. All four supported tokens always returned, even at zero balance, so the UI can render a stable list. **Surface placement still open** (per P6-002 note) — the design's chat grid uses "Fund Agent Wallet" as its 6th card; the Portfolio response can hang off either the Wallet card sub-step (P6-003) or a route off the main shell when the design lands. UI deferred per TD-004.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🟡     |
| P6-009 | Autonomous mode: natural-language instruction input. Server-side endpoint shipped as part of P6-010 (`POST /api/agent/instruction`). The autonomous-mode chat UI itself — text input + result rendering + auto-execute wiring — is **deferred** per the design-driven UI rule (TD-004 expanded). The Chat-mode AgentPanel autonomous-step body remains the placeholder card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 🟡     |
| P6-010 | NLP parser: swap, send, add/remove liquidity, query, wallet ops. **Server-side shipped** via `server/src/lib/agent-nlp.ts:parseInstruction` and `POST /api/agent/instruction` in `server/src/routes/agent-instruction.ts`. Uses the official `@anthropic-ai/sdk` against `claude-opus-4-7` with adaptive thinking + `effort: "low"` + tool-use for structured output. Eight tools defined: six action tools (swap / send / add_liquidity / remove_liquidity / query / wallet) plus `clarify` (medium-confidence) and `reject` (low-confidence) — D-014's confidence thresholds (≥0.85 / 0.65–0.85 / <0.65) are encoded by tool selection rather than a numeric score the model can't really calibrate. System prompt + tool defs are cached via `cache_control: ephemeral` so per-instruction cost stays low. Returns `{ intent, raw, model, cacheReadInputTokens, cacheCreationInputTokens }`. Errors: 503 `ANTHROPIC_UNAVAILABLE` if the API key isn't configured, 502 `UPSTREAM_FAILURE` for any other Anthropic SDK failure. Auto-execution wiring (intent → action endpoint) is deferred to P6-009's UI work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 🟡     |
| P6-011 | Agent-level spending cap (independent of user cap, set per agent wallet). Cap **lookup** was already in place from Phase 1 — `server/src/lib/spending-cap.ts:getDailyCap` falls through to `agent_wallets` when the user-wallet lookup misses, so a single `daily_wallet_spend` ledger keyed on wallet address transparently handles both wallet kinds. P6-011 adds the **set** path: `updateAgentWalletCap(privyUserId, dailyCapUsd)` in `server/src/lib/agent-wallet.ts` and `PATCH /api/agent/wallet/cap` (zod-validated, `0 ≤ cap ≤ HARD_DAILY_CAP_USD`, requireAuth, audit-logged) in `server/src/routes/agent-wallets.ts`. Caller is restricted to the user's own agent wallet via privyUserId scope. Cap-management **UI is deferred** for the same reason as P6-003's Fund UI — the Mantua design source has no cap-management form (TD-004 closure now covers both Fund and cap UIs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅     |
| P6-012 | E2E: all 6 actions in Chat mode + 5 instruction types in Autonomous mode. **Acknowledged-and-deferred** via TD-005 — every server-side ticket from P6-003 through P6-010 ships untested against a real DB + real CDP + real Trading API + real Anthropic. The orchestration test gap is the same shape as TD-003 (one-ticket scope) but P6-012's deliverable is a full E2E harness covering all six chat-mode actions and the five autonomous-mode instruction types end-to-end. Cannot land without (a) the deferred UIs (TD-004) — there's nothing to drive E2E from yet — and (b) a funded test agent wallet with a stable signer setup. Status 🟡 until both gates close.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🟡     |

### Agent Safety Notes

- Agent wallet has its own spending cap separate from user wallet (P1-001)
- All agent transactions logged in audit log (P1-008)
- Kill-switch (P1-006) halts agent write ops immediately
- Agent cannot change caps, cannot disable safety rails, cannot bypass slippage limits

---

## 📊 PHASE 7: DefiLlama Analytics

> Replaces Dune MCP from v1. Covers protocol TVL, yields, token prices, volume.

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P7-001 | DefiLlama integration. Server-side uses **direct HTTP** against DefiLlama's open APIs (`yields.llama.fi`, `api.llama.fi`, `coins.llama.fi`) in `server/src/lib/defillama.ts` — no auth required. The "DefiLlama MCP" in the dev skills list is a Claude Code developer skill (for ad-hoc querying during development), not a server-runtime integration; the server doesn't depend on MCP.                                                                                                                                                                                                                                                                                                                                                    | ✅     |
| P7-002 | Chat intent detection: route analytics questions to DefiLlama, trade questions to Uniswap. Shipped via P6-010's NLP parser (`server/src/lib/agent-nlp.ts:parseInstruction`), which routes `query` intents to DefiLlama-equivalent endpoints and `swap`/`send`/`add_liquidity`/`remove_liquidity` to Uniswap action endpoints.                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅     |
| P7-003 | Supported queries: protocol TVL, DEX volume, yield APYs, token price, historical charts. **Server-side shipped** via `server/src/lib/defillama.ts` (six query primitives) and `GET /api/analytics?type=...` in `server/src/routes/analytics.ts` (a discriminated-union route over the six types: `pools`, `pool`, `chart`, `protocol`, `dex_volume`, `token_price`). New API surfaces: `getProtocol(slug)` against `api.llama.fi/protocol/{slug}`, `getChainDexOverview(chain)` against `api.llama.fi/overview/dexs/{chain}`, `getTokenPrices(coins)` against `coins.llama.fi/prices/current/...`. The `pools` + `chart` variants reuse the existing Phase 4 primitives (`listBasePools`, `poolChart`). All cached at the lib layer (P7-005). | ✅     |
| P7-004 | Result rendering: tables for tabular data, lightweight-charts for time series. **UI deferred** — the design source has no analytics-view design yet; tracked under TD-004 along with the rest of the Phase 6/7 UI gaps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🟡     |
| P7-005 | Cache DefiLlama responses (60s TTL) to respect rate limits. Already shipping — `server/src/lib/defillama.ts:18 TTL_MS = 60_000` and the shared `cached()` helper covers every DefiLlama call, including the new P7-003 additions. Cache keys include the request shape (e.g. `protocol:<slug>`, `dexs:<chain>`, `prices:<sorted-coins>`) so order-insensitive callers still hit.                                                                                                                                                                                                                                                                                                                                                              | ✅     |
| P7-006 | E2E: 10 representative analytics queries return valid, formatted results. **Acknowledged-and-deferred** via TD-005 (the Phase-6 E2E harness gap also covers Phase 7). The 10 queries should exercise: list pools (Base), single pool by id, chart for a known pool, two protocol-by-slug lookups, two chain dex_volume lookups, three token_price queries (mixed `coingecko:id` + `chain:address` keys). Cannot land without (a) the deferred analytics UI (TD-004) and (b) the broader E2E harness scaffold. Status 🟡 until both close.                                                                                                                                                                                                     | 🟡     |

### Example Supported Queries

- "What's the TVL of Uniswap on Base?"
- "Top 5 yield pools on Base right now"
- "DEX volume on Base last 7 days"
- "cbBTC price over the last 30 days"
- "Which stablecoin has the highest APY on Base?"

---

## 💼 PHASE 8: Portfolio Page

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P8-001 | Portfolio landing: layout per `Mantua Prototype.html` portfolio screen (do not replicate v1 3-column Hyperliquid layout). **UI deferred** to TD-004 — design source has the screen but the v2 design port hasn't landed in `client/src/features/portfolio/` yet. Server data layer for the page is shipping in P8-003 / P8-004 / P8-005.                                                                                                                                                                            | 🟡     |
| P8-002 | USD valuation via DefiLlama or CoinGecko (mainnet prices — NOT hardcoded). Already shipping — `server/src/lib/usd-pricing.ts:tokenAmountUsd` (CoinGecko, 60s cached) is used everywhere USD math happens (cap rails, agent portfolio, user portfolio). DefiLlama prices via `getTokenPrices` (P7-003) are also available for the analytics view.                                                                                                                                                                    | ✅     |
| P8-003 | Tab: Balances (ETH, cbBTC, USDC, EURC) with USD value and swap shortcut. **Server-side shipped** via `server/src/lib/user-portfolio.ts:getUserPortfolio` and `GET /api/portfolio` in `server/src/routes/portfolio.ts`. Reads on-chain balances via `baseRpcClient` (native ETH via `getBalance`, ERC-20s via `balanceOf`); USD values via `tokenAmountUsd`; one row per supported token even at zero balance so the UI list is stable. UI (the actual Balances tab + swap shortcut) deferred to TD-004.             | 🟡     |
| P8-004 | Tab: LP Positions with hook badges (Stable Protection, DynamicFee, etc.). **Server-side already exists** — `GET /api/positions` (P4-009) lists Mantua-opened + pre-Mantua positions with `hookAddress` populated; the client renders a hook badge by mapping address → name. UI deferred to TD-004.                                                                                                                                                                                                                 | 🟡     |
| P8-005 | Tab: Swap History, Pool History, Deposits — all with BaseScan links. **Server-side shipped** as part of `GET /api/portfolio`'s `transactions` field — pulls from `portfolio_transactions` filtered by `walletAddress = req.walletAddress`, ordered by `createdAt` desc, default limit 50. Same table the agent path records into. The three tabs (Swap / Pool / Deposits) filter by `action` field client-side; if the count gets large, add server-side filtering via `?action=swap` later. UI deferred to TD-004. | 🟡     |
| P8-006 | "Hide Small Balances" toggle (< $1 USD equivalent). **Server-side shipped** via `PATCH /api/preferences` in `server/src/routes/portfolio.ts` (zod-validated; persists `user_preferences.hide_small_balances`). The current value is included in the `preferences` block of `GET /api/portfolio`. UI for the toggle itself (Balances tab) deferred to TD-004.                                                                                                                                                        | 🟡     |
| P8-007 | Agent Portfolio view: switcher between user wallet and agent wallet. **Server-side already in place** — `GET /api/portfolio` (this PR) for the user wallet and `GET /api/agent/portfolio` (P6-008) for the agent wallet. Both return the same shape. The switcher UI is deferred to TD-004; once it lands, it's a one-line route swap.                                                                                                                                                                              | 🟡     |

---

## 🗣️ PHASE N: Natural Language Command Bar

> Unified LLM-powered command bar that appears on Swap, Liquidity, and Agent pages. Users type natural-language intents; the LLM parses them into structured actions; the app confirms before executing.
>
> **Example inputs:**
>
> - "Add liquidity to a USDC/EURC pool with stable protection"
> - "Swap 0.05 ETH for USDC"
> - "Create a new ETH/cbBTC pool with 0.30% fee tier"
> - "Remove 50% of my liquidity from the cbBTC/USDC pool"
> - "What's the TVL on Uniswap Base?"
> - "Send 10 USDC to vitalik.eth"

### Parser & Infrastructure

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PN-001 | Build LLM provider abstraction (`parseIntent` interface): primary calls Anthropic Claude (Sonnet 4.6 or successor), fallback to OpenAI GPT on availability error. **Anthropic primary shipped** via `server/src/lib/command-bar-nlp.ts:getAnthropic` (model `claude-sonnet-4-6` per spec) and the agent-mode parser at `server/src/lib/agent-nlp.ts` (P6-010). **OpenAI fallback deferred** to TD-006 — adds `openai` SDK + try/catch fallback shape; one-line provider-switch config follows naturally.                        | 🟡     |
| PN-002 | Define structured intent schema: `{ action, params, confidence }` with Zod validation. **Shipped** via `server/src/lib/command-bar-nlp.ts:intentSchema` — `z.discriminatedUnion("action", [...])` over the 7 supported intents + `clarification_needed` + `reject`. Each variant carries an explicit `confidence: z.number().min(0).max(1)`. Schema mirrors the spec at PN-002 Details (lines 656-693) with the addition of an explicit `reject` variant for off-scope inputs.                                                  | ✅     |
| PN-003 | Implement parser: `parseIntent(userText, context) → Intent` using function calling / structured output. **Shipped** via `server/src/lib/command-bar-nlp.ts:parseCommand(text, context?)`. Uses Anthropic tool-use with `tool_choice: {type: "any"}` to force one of the 9 tools (7 actions + clarify + reject) per call. System prompt + tool defs cached via `cache_control: ephemeral` so per-command cost stays low.                                                                                                         | ✅     |
| PN-004 | Implement confidence routing: ≥0.85 → present preview + execute; 0.65–0.85 → clarification question; <0.65 → reject with rephrase request. **Shipped** via tool-selection-derived confidence: action tools → 0.95, `clarification_needed` → 0.75, `reject` → 0.40 (constants `ACTION_CONFIDENCE` / `CLARIFY_CONFIDENCE` / `REJECT_CONFIDENCE` in `command-bar-nlp.ts`). Audit log via `command_parse` action records `intentAction` + `confidence` so false-clarify / false-execute rates are queryable for PN-011 beta tuning. | ✅     |
| PN-005 | Supported intents: swap, add_liquidity, remove_liquidity, create_pool, send_tokens, query_analytics, portfolio_summary. **All 7 shipped** as discrete tools in `command-bar-nlp.ts:TOOLS`. Distinct from the agent-mode parser (P6-010), which uses different naming (`tokenA/tokenB/fee` vs Phase N's `token0/token1/feeTier`) and a different intent set (`wallet` instead of `portfolio_summary`, no `create_pool`).                                                                                                         | ✅     |

### Command Bar UI

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| PN-006 | Build `<CommandBar />` component per design prototype — appears on Swap, Liquidity, Agent pages. **Shipped** at `client/src/features/command-bar/CommandBar.tsx`, ported from F8 in `~/Downloads/mantua-ai/project/src/agent_flows.jsx`. Mounted in `client/src/App.tsx:RightColumn` for routes in `ROUTES_WITH_COMMAND_BAR` (swap / pools / pool / pool-create / add-liquidity / positions / agent). Sticky `position: sticky; top: 0; z-index: 50` per design. ⌘K / Ctrl-K focuses the input from anywhere on the page; Esc dismisses. Wired to the real `POST /api/command/parse` (PN-003) and renders results through the existing `IntentCard` (high / low / failed tones already match clarify / reject confidence levels). | ✅     |
| PN-007 | Context awareness: parser receives current page context (e.g. "user is on Liquidity page") to bias intent disambiguation. **Shipped server-side** — `parseCommand(text, context)` accepts an optional `PageContext` (`page`, `poolId`, `tokenInFocus`, `note`) and renders it as a `[Context: ...]` prefix on the user message; system prompt instructs the LLM to use it for disambiguation. The UI side that populates context per route (Swap page passes `page="swap"`, Liquidity passes `page="liquidity" poolId=...`, etc.) lands when the CommandBar UI lands (TD-004).                                                                                                                                                    | ✅     |
| PN-008 | Preview card: after parsing, show the parsed intent as a structured preview BEFORE the confirmation modal. **Shipped** via `client/src/features/agent/IntentCard.tsx` (already existed for F7 autonomous mode; reused by the CommandBar). High-confidence intents render in accent purple with a Cancel / Confirm-and-open button row; clarification_needed renders in amber with the LLM's question; reject renders in red with three suggestion chips the user can tap to re-run the parse. `summarizeIntent()` in `CommandBar.tsx` produces the headline string per intent kind.                                                                                                                                               | ✅     |
| PN-009 | Clarification loop: if confidence < threshold OR required param missing, LLM asks a follow-up question instead of executing. **Single-turn shipped** — the CommandBar renders the LLM's `clarification_needed` message in the IntentCard with the amber low-confidence tone; the user can dismiss and retype. **Multi-turn re-parse loop** (capture user's reply, append to the conversation, re-parse with the prior intent as context) is the remaining gap — needs a small message-history state + a second `parseCommand` call that includes the prior `clarification_needed` message in the prompt. Tracked under TD-004 item 11 follow-up.                                                                                  | 🟡     |

### Safety

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| PN-010 | Safety rail: confirmation modal (P1-005) is mandatory for every parsed intent that triggers a tx — LLM output never executes directly. **Safety invariant preserved** end-to-end: server never auto-executes (`POST /api/command/parse` returns the intent and stops); `CommandBar.tsx:onIntent` navigates to the matching action surface (e.g., `swap` intent → `setRoute({ kind: "swap" })`) rather than executing; the destination page (SwapPanel, AddLiquidityForm, etc.) runs its own `useConfirmedAction` flow before broadcasting any tx. **Pending: parameter passthrough** — the parsed intent's params (e.g. `tokenIn` / `amountIn` for a swap) currently aren't pre-filled into the destination page's form, so the user re-enters them. Closing this requires each destination page to accept incoming-intent props; pass-2 follow-up under TD-004 item 11. | 🟡     |
| PN-011 | E2E test: 25 prompt variations per intent type (swap, LP, create pool, send, query) — verify correct parsing and param extraction. **Deferred** to TD-005 (Phase 6 + Phase 7 + Phase N E2E test harness). Concrete prompts will be added to TD-005's closure-condition list when the harness exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 🟡     |

### PN-002 Details: Intent Schema

```typescript
type Intent =
  | {
      action: "swap";
      tokenIn: TokenSymbol;
      tokenOut: TokenSymbol;
      amountIn: string;
      confidence: number;
    }
  | {
      action: "add_liquidity";
      token0: TokenSymbol;
      token1: TokenSymbol;
      amount0?: string;
      amount1?: string;
      feeTier?: number;
      hook?: HookType;
      confidence: number;
    }
  | { action: "remove_liquidity"; poolId: string; percentage: number; confidence: number }
  | {
      action: "create_pool";
      token0: TokenSymbol;
      token1: TokenSymbol;
      feeTier: number;
      hook?: HookType;
      confidence: number;
    }
  | {
      action: "send_tokens";
      token: TokenSymbol;
      amount: string;
      recipient: string;
      confidence: number;
    }
  | { action: "query_analytics"; question: string; confidence: number }
  | { action: "portfolio_summary"; confidence: number }
  | { action: "clarification_needed"; message: string; suggestedIntent?: Partial<Intent> };
```

### PN-010 Details: LLM Output Never Auto-Executes

This is a CRITICAL safety rule. The LLM parses; the user confirms. There is no path from LLM output to on-chain transaction that bypasses the confirmation modal. A misparsed "swap 10 USDC" becoming "swap 10 ETH" must be catchable at the preview stage. Never trust the LLM alone for financial execution.

### Example Prompt → Intent

```
Input:  "Add liquidity to a USDC/EURC pool with stable protection"
Output: {
  action: 'add_liquidity',
  token0: 'USDC',
  token1: 'EURC',
  hook: 'stable',
  amount0: undefined,  // prompt follow-up: "How much USDC and EURC would you like to add?"
  amount1: undefined,
  feeTier: 0.01,        // inferred: stablecoin pair → default 0.01%
  confidence: 0.92
}
```

---

## ✅ PHASE 9: E2E Testing & Launch (Base Mainnet)

Mantua v2 ships on **Base Mainnet (8453)** — the single supported chain.
Real user funds are in play from day one, so the Phase 1 safety rails,
the security sign-off, and the hook redeployment/verification below are
all launch-gating.

| ID     | Task                                                                                                                                                                                                                                                 | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P9-001 | Full E2E test suite in Playwright — all flows Phase 3–8 against Base Mainnet (Anvil fork for writes). **Browser suite shipped** (task 067, G-001/G-002: `client/e2e`, in CI on every PR, chain scripted); the fork-backed write path waits on P9-002 | 🟡     |
| P9-002 | Base Mainnet fork test environment for CI — `contracts.yml` runs the gating fork suites on a Base Mainnet fork with a public-RPC fallback, green on `main` (ledger G-003)                                                                            | ✅     |
| P9-003 | Confirm AI-assisted security analysis sign-off for the hook deployments (P5-026); residuals logged                                                                                                                                                   | ✅     |
| P9-004 | Provision hosting per D-004: Vercel (frontend) + Railway or Fly.io (backend) + Neon (Postgres)                                                                                                                                                       | ⬜     |
| P9-005 | Configure CI/CD: GitHub Actions → Vercel + Railway/Fly deploy; staging branch auto-deploys                                                                                                                                                           | ⬜     |
| P9-006 | Production build: frontend + backend + DB migrations                                                                                                                                                                                                 | ⬜     |
| P9-007 | Deploy to staging, dogfood internally with team wallets (small real balances) for at least 2 weeks                                                                                                                                                   | ⬜     |
| P9-008 | Mainnet E2E: 10+ funded transactions across swap, LP, agent, all 4 hooks                                                                                                                                                                             | ⬜     |
| P9-009 | Terms of Service + Privacy Policy drafted and reviewed — **drafted and live in the app with recorded acceptance** (task 067, G-012 … G-014); counsel review is the owner's (G-015)                                                                   | 🟡     |
| P9-010 | Incident runbook: kill-switch activation, rollback, user comms — `docs/ops/incident-runbook.md` §1–§13 including the timed rehearsal script (G-016); the staging rehearsal itself is G-017                                                           | ✅     |
| P9-011 | Soft launch: limited organic announcement, monitor for issues                                                                                                                                                                                        | ⬜     |
| P9-012 | Public launch announcement (open to all)                                                                                                                                                                                                             | ⬜     |
| P9-013 | Deploy + verify all four hooks on Base Mainnet (`npm run verify:hooks`; `docs/security/hook-deployments.md`)                                                                                                                                         | ⬜     |

### Launch gate

- Phase 0 → 8 backend on `main`: ✅ as of merge of #59 (Phase 6/7/8 stack)
- TD-004 closes — Mantua design source delivers UI flows for Phases 6/7/8 + analytics view (P7-004) + portfolio page (P8-001 → P8-007): required
- TD-005 closes — Phase 6 + 7 E2E test harness with funded agent wallet: required
- Internal dogfood ≥ 2 weeks with zero critical incidents (P9-007): required
- Hook deployment + verification on Base Mainnet (P9-013): required before hook-gated pools open
- **Not required for the initial (zero-fee) beta:** PF-005 → PF-010 (fee admin) and fee-collection code paths in production; they gate the fee turn-on per D-015, along with Risk 1 (EOA hardware-wallet hygiene) and Risk 2 (full crypto-counsel review).

## 🚦 PHASE 10: Launch Gate — E2E, Security, Legal (task 067, D-117)

The three lists above (this table, "Launch gate", "Public launch gate")
plus B10-010, TD-005, and the open sign-off items are reconciled into one
ledger, **`docs/tasks/launch-gate.md`** (G-001 … G-018). Twelve rows are
closed inside the repository with a test, a CI job, or a document; six
are the owner's and name the artifact that flips them.

| ID          | Gate                                                                                                  | Status |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------ |
| G-001/G-002 | Browser E2E (real client, Chromium, chain scripted) — in CI on every PR                               | ✅     |
| G-006–G-010 | Security headers, route-guard audit, secret scan, dependency triage, rails review + sign-off addendum | ✅     |
| G-012–G-014 | Terms / Privacy describe the shipped product; versioned acceptance recorded before the first trade    | ✅     |
| G-016       | Runbook rehearsal script                                                                              | ✅     |
| G-003       | Fork suites run in CI on a Base Mainnet fork (`contracts.yml`)                                        | ✅     |
| G-004/G-005 | Hosting, CI/CD — owner                                                                                | 🟡     |
| G-011       | Mainnet deploy + verify (P9-013, D-112) — owner                                                       | 🟡     |
| G-015       | Counsel review — owner                                                                                | 🟡     |
| G-017/G-018 | Staging drill + dogfood + funded run; M-01 / L-03 / fork suites / human audit — owner                 | 🟡     |

## ⏸ PHASE 11 — deferred

Skipped for now on the owner's instruction (2026-09-13); no scope recorded
in the repository yet. To be supplied with its row table.

## 🔍 PHASE 12: Market Depth & Research Layer (task 068)

Progressively deeper information per market — users never leave the
market page to understand what they're trading. Ledger and evidence:
`docs/tasks/068-market-depth.md`.

| ID    | Task                                                                                                                  | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| D-001 | Market page deep data: price/implied probability, history, volume, liquidity/depth, movement, open interest, activity | ✅     |
| D-002 | Live game panel: score, clock, situation from the sports data layer                                                   | ✅     |
| D-003 | AI research section per market (`sports_intelligence`), labelled as an agent estimate                                 | ✅     |
| D-004 | Layered disclosure: simple surface, sections closed by default, fees and execution in the deeper view                 | ✅     |
| D-005 | Price chart annotations: kickoff, period starts, freeze, resolution, injury reports                                   | ✅     |
| D-006 | Depth ladder for the pro layer (an AMM has no order book; the cost to move the price is shown instead)                | ✅     |
| D-007 | Historical market browser: resolved markets with outcomes, settlement, and price paths                                | ✅     |
| D-008 | E2E: every listed data point reachable from a market page without leaving it (`client/e2e/market.spec.ts`)            | ✅     |

---

## ⚠️ Critical Implementation Rules

1. **Base Mainnet only** — the live target is Base Mainnet (chain ID 8453); `MANTUA_NETWORK` defaults to `mainnet`. Any other chain ID is rejected at the boundary. No Anvil in production code paths.
2. **Chain ID matches `MANTUA_NETWORK`** — read from `useChainId()` and reject mismatches
3. **NEVER hardcode token prices** — Dune's hardcoded placeholder prices (ETH=$2000 etc.) were a v1 expedient; v2 pulls live prices
4. **NEVER duplicate swap/liquidity logic** — single shared module, used by UI and agent
5. **ALWAYS confirm transactions on-chain** — wait for receipt before UI "success"
6. **ALWAYS store transactions in DB** before showing success state
7. **ALWAYS show BaseScan link** for every transaction
8. **File length max 150 lines** — split into modules
9. **No TODOs** — every shipped feature fully implemented
10. **No `any` types** — TypeScript strict mode enforced
11. **No hardcoded secrets** — all via env vars, `.env` gitignored
12. **Mainnet safety rails (Phase 1) must pass before Phase 3+ ships**

---

## ✅ Definition of Done (v2)

### Staging gate (internal dogfood)

- [ ] Phase 0–4 complete (bootstrap, safety, integrations, swap, LP)
- [ ] Phase 5 complete for Stable Protection (other hooks gated on D-002)
- [ ] Phase 6 complete (agent Chat + Autonomous)
- [ ] Phase 7 complete (DefiLlama)
- [ ] Phase 8 complete (Portfolio)
- [ ] Phase 9 items 001–008 complete
- [ ] Kill-switch tested in staging (script: `docs/ops/incident-runbook.md` §13; ledger G-017)
- [ ] Team has dogfooded for ≥ 2 weeks with zero critical incidents (G-017)

### Public launch gate

- [ ] All above +
- [ ] AI-assisted security analysis sign-off complete (`docs/security/sign-off.md`); HIGH severity findings all resolved
- [ ] Terms of Service + Privacy Policy live (in the app with recorded acceptance — G-012 … G-014 ✅; counsel-reviewed — G-015 🟡)
- [ ] Incident runbook rehearsed, on-call rotation established (runbook + script ✅ G-016; rehearsal G-017 🟡)
- [ ] EOA fee recipient configured with hardware wallet, seed phrase backed up offline (Risk 1 mitigation tracked)
- [ ] Public documentation published

---

## 📊 Task Count Summary

| Phase                                             | Tasks   |
| ------------------------------------------------- | ------- |
| Phase 0: Project Bootstrap                        | 8       |
| Phase D: Design System & UI Shell                 | 8       |
| Phase 1: Mainnet Safety                           | 8       |
| Phase 2: Skill, MCP & Wallet Provider Integration | 16      |
| Phase 3: Swap (Core)                              | 8       |
| Phase 4: Liquidity                                | 10      |
| Phase 5: Hook Integration + AI Security Analysis  | 26      |
| Phase F: LP & Mantua Fee                          | 10      |
| Phase 6: Agent                                    | 13      |
| Phase 7: DefiLlama Analytics                      | 6       |
| Phase 8: Portfolio                                | 7       |
| Phase N: Natural Language Command Bar             | 11      |
| Phase 9: E2E & Launch                             | 13      |
| Phase 10: Launch Gate (ledger G-001 … G-018)      | 18      |
| Phase 12: Market Depth & Research Layer           | 8       |
| **Grand Total**                                   | **170** |

### Future phases

- Phase 19 — Arc: future financial/institutional chain (re-introduction)

---

## 🔗 Reference Links

| Resource                | URL                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Base Mainnet explorer   | https://basescan.org/                                                                                   |
| Privy dashboard         | https://dashboard.privy.io                                                                              |
| Privy React docs        | https://docs.privy.io/basics/react/quickstart                                                           |
| Uniswap Trading API     | https://docs.uniswap.org/api/trading/overview                                                           |
| Uniswap AI skill        | `npx skills add uniswap/uniswap-ai --skill swap-integration`                                            |
| Coinbase agentic-wallet | `npx skills add coinbase/agentic-wallet-skills`                                                         |
| DefiLlama setup         | https://raw.githubusercontent.com/DefiLlama/defillama-skills/refs/heads/master/defillama-setup/SKILL.md |
| CDP SDK docs            | https://docs.cdp.coinbase.com/cdp-sdk/docs/welcome                                                      |
| CoinGecko API           | https://api.coingecko.com/api/v3                                                                        |
| Foundry book            | https://book.getfoundry.sh/                                                                             |
