# Mantua AI v2 — Architecture

Living document. Updated as the build progresses.

## Repository layout

```
mantua-intelligence/
├── client/                  # Vite + React 19 + TS strict + Tailwind 4 frontend
├── server/                  # Express 5 + TS + Drizzle + Zod backend
├── contracts/               # Foundry project for Uniswap v4 hooks
├── docs/
│   ├── architecture.md      # this file
│   ├── tasks/               # roadmaps, task lists
│   ├── decisions/           # decision memos
│   ├── design/              # design tokens, deviations from prototype
│   ├── promptHistory/       # notable LLM prompts and outputs
│   └── security/            # AI-assisted security analysis findings + sign-off
├── prototype/               # NOT YET — v1 prototype currently lives at repo root
│   └── (Mantua Prototype.html, src/, assets/, landing/)
└── README.md
```

The v1 prototype (`Mantua Prototype.html` + `src/` + `assets/` + `landing/`) currently lives at the repo root and is the design reference for Phase D. It will be moved into `prototype/` in a later phase if needed; until then it is read-only.

## Stack at a glance

| Layer       | Tool                                      | Why                                               |
| ----------- | ----------------------------------------- | ------------------------------------------------- |
| Frontend    | Vite + React 19 + TypeScript (strict)     | Fast dev loop, strong types, broad ecosystem      |
| Styling     | Tailwind 4 + Shadcn/ui                    | Token-driven CSS, accessible primitives           |
| Auth/wallet | Privy (`@privy-io/react-auth`) + viem     | Embedded + external wallets; viem for chain calls |
| Backend     | Express 5 + TypeScript (strict)           | Mature, predictable; no over-frameworking         |
| ORM         | Drizzle                                   | TS-first, lightweight, schema-as-code             |
| Validation  | Zod 4                                     | Runtime + compile-time guarantees at boundaries   |
| DB          | PostgreSQL (Neon planned per D-004)       | Serverless Postgres with branching for staging    |
| Contracts   | Foundry (forge / anvil / cast)            | Standard for v4 hook work                         |
| LLM         | Anthropic Claude primary, OpenAI fallback | Per D-013; provider-abstracted                    |

## Open architectural notes

- **Branching (B-011):** one branch per task document, named to match —
  task docs live in `docs/tasks/NNN-short-slug.md` and the branch carries
  the same `NNN-short-slug` name. See `docs/tasks/011-branch-management.md`.
- **Chain lock:** Base Mainnet only (chain ID 8453). Privy `supportedChains` and viem clients are configured with Base only; any other chain ID is rejected at the boundary. The `useBaseWalletClient` hook (`client/src/lib/privy/wallet-client.ts`) attempts an automatic chain switch and throws if the wallet remains off-Base.
- **Two-process dev:** `npm run dev` at the root spawns client (Vite, HTTPS via self-signed cert) and server (Express) in parallel. Each has its own port. Frontend talks to backend via a base URL from env.
- **HTTPS in dev:** Privy's Web Crypto API key sharding silently fails over plain HTTP outside `localhost`. The Vite dev server runs HTTPS by default via `@vitejs/plugin-basic-ssl`. The browser will warn about the self-signed cert on first load — that's expected; click through. Staging/prod use real TLS (Vercel handles this for the frontend).
- **Single shared logic:** Critical Phase 3 / Phase 4 modules (swap, liquidity) are written once on the server and exposed via API endpoints; the agent (Phase 6) calls the same endpoints. No client-side duplication of swap-construction logic.

## Auth flow (Phase 2)

1. Client renders `<MantuaPrivyProvider>` at the root with `loginMethods` per D-005, `embeddedWallets.createOnLogin: 'users-without-wallets'` per D-006, and `walletConnectCloudProjectId` per D-007.
2. User logs in via `usePrivy().login()`. Privy provisions an embedded wallet for email/Google/Apple/passkey logins, or uses the connected external wallet.
3. Client obtains an identity token via `getAccessToken()` and sends it as `Authorization: Bearer <token>` on API calls.
4. Server `attachAuth` middleware (`server/src/middleware/auth.ts`) verifies the token via `@privy-io/server-auth`, then populates `req.privyUserId` and `req.walletAddress` for downstream handlers.
5. Routes that must reject anonymous traffic chain `requireAuth` after `attachAuth`.

`req.walletAddress` is what `walletRateLimiter` (P1-007) keys on once auth is wired into write paths.

## Fiat rails — Deposit → Trade → Withdraw (Phase F)

### D-101: selected provider and integration boundary

**Selected ramp: Zero Hash, subject to execution of its platform agreement and
production approval.** Zero Hash is the regulated financial counterparty for
USD ↔ USDC conversion, ACH/RTP money movement, customer KYC/AML and transaction
monitoring. Mantua is an orchestration and trading application; it does not
accept customer deposits, hold a fiat balance, custody the customer’s primary
wallet keys, or make compliance eligibility decisions.

**Bank link: Plaid.** Mantua obtains a Plaid Link token server-side and receives
only the short-lived public token callback. It exchanges that token server-side
and creates a Zero Hash processor token/external account. Raw account/routing
numbers and Plaid access tokens must never reach the browser, app database,
logs, analytics, or LLM context. Plaid products required before production are
Auth, Balance, Identity, and Identity Match.

| Product surface      | Behind the scenes                                                               | Owner / boundary                                            |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Connect bank account | Plaid Link → processor token → Zero Hash external account                       | Plaid + Zero Hash                                           |
| Deposit dollars      | ACH/RTP debit → Zero Hash conversion → USDC delivered to the user’s Base wallet | Zero Hash; Circle provides wallet infrastructure where used |
| Trade                | User signs a Base transaction through Privy; Mantua routes market activity      | User / Privy / Base                                         |
| Withdraw dollars     | USDC conversion → ACH/RTP credit to the linked account                          | Zero Hash                                                   |
| Direct USDC          | User trades from their connected Base wallet without a bank link                | User / Privy / Base                                         |

The product wording intentionally excludes wallets, bridges, private keys,
network names, and gas from cash screens. It says only **Deposit**, **Trade**,
and **Withdraw**. The existing Circle agent wallet remains a separately funded,
bounded agent budget; it is never a hidden destination for a user’s fiat
deposit and cannot initiate a user withdrawal.

### Current implementation and production gate

`server/src/routes/fiat-rails.ts` provides the authenticated product contract:
state, sandbox bank-link initiation, deposits, withdrawals, and audit events.
`FIAT_RAILS_MODE=disabled` is the production-safe default. A deterministic
`sandbox` adapter supports the user flow and E2E-style state transitions without
contacting a bank or minting USDC. `live` deliberately fails closed until all of
the following are completed:

1. Zero Hash agreement, participant/platform code, production API access, and
   explicit Base-USDC availability are confirmed.
2. Plaid production approval and the Zero Hash processor integration are
   enabled; credentials are stored in the deployment secrets manager.
3. Provider request signing, webhook signature verification, idempotency keys,
   persisted transfer/external-account records, reconciliation, and support
   recovery runbook are implemented and independently tested.
4. A sandbox test proves: link bank → initiate deposit → completed status →
   credited wallet balance → withdrawal → provider receipt. No simulated result
   counts as fiat movement evidence.

Zero Hash may reject, hold, return, or reverse a transfer; UI states therefore
remain `pending`, `complete`, or `needs attention` and never optimistically
credit a user balance. Pending cash activity is refreshed automatically and the
provider’s final receipt is the source of truth in live mode.

## Circle agent wallet (Phase 6)

### Wallet boundary (D-008 — confirmed P6-000, 2026-04-30; provider updated by D-110, 2026-09-02)

Mantua runs **two wallets per user**, owned by different actors:

| Wallet                | Owner     | Holds                    | Signing rights                                | Funded by                                     |
| --------------------- | --------- | ------------------------ | --------------------------------------------- | --------------------------------------------- |
| Privy embedded wallet | The user  | The user's primary funds | User only (Privy auth)                        | User's existing on-ramp                       |
| Circle agent wallet   | The agent | A user-set budget        | Server via Circle DCW (entity-secret custody) | User explicitly transfers from Privy → Circle |

**Hard rule:** the agent never holds, sees, or can sign with the Privy wallet's keys. There is no path in code that lets the agent move funds out of the Privy wallet. The user funds the agent by sending tokens from Privy to the Circle wallet — this is the only direction funds cross the boundary, and it always requires the user's signature on the Privy side.

**Why** (full rationale in `docs/decisions/v2-open-decisions.md` D-008): an autonomous LLM-driven actor must not have signing rights over the user's primary funds. Bounding the agent's blast radius to a separately-funded agent wallet means the worst case from any agent bug, prompt injection, or misparsed instruction is loss of the agent's budget — not the user's main holdings. Mental model: Zapier doesn't get your Gmail password.

**Spending caps stack at the wallet, not the user.** The user's Privy wallet has its own daily cap (D-009 / P1-001). The agent's Circle wallet has its own, independent cap (P6-011) that the user sets when funding the agent. Caps are enforced server-side in `server/src/lib/spending-cap.ts` against `daily_wallet_spend` keyed on the wallet address — the cap doesn't know which wallet is "primary" and which is "agent," and that's intentional.

**Recovery.** If the user wants to "unfund" the agent, they sweep the Circle wallet back to their Privy wallet. The Circle wallet is not destroyed — it just sits empty, ready to be re-funded. There is no protocol-level concept of "deleting an agent."

### Implementation path

The implemented provider is **Circle Developer-Controlled Wallets**
(`@circle-fin/developer-controlled-wallets`, `server/src/lib/circle/`) —
SCA accounts on Base, blockchain id `"BASE"`, provisioned per user into a
wallet set (`agent_wallets` Drizzle table). This supersedes the earlier
CDP-SDK plan for P6-003; the wallet-boundary and cap design above are
provider-independent and carried over unchanged (see D-110 for the
reconciliation and migration path). Credentials live in env
(`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`); they are
`.optional()` so the server boots without them and agent features 503.
Every agent write funnels through `circle/execute.ts` and the
`allowed-targets.ts` allowlist. Phase 1 hardening exit criteria (D-110 /
reusability audit): confirm to mined receipt rather than Circle's `SENT`
state, hard-fail on an unset `CIRCLE_WALLET_SET_ID` in production, verify
the mainnet Gas Station sponsorship policy, and bound agent-side approvals.

### Custody posture (C-009)

Who holds which key, stated from the code:

1. **User custody — Privy, non-custodial.** Users sign with Privy embedded
   wallets (auto-created for `users-without-wallets`) or their own external
   wallets, incl. WalletConnect (`client/src/lib/privy/config.ts`,
   `provider.tsx`). Keys live with Privy's client-side key management and the
   user's wallet — never on Mantua's server. The server only ever receives
   signed transactions/messages; signing happens in the browser through the
   wallet's EIP-1193 provider, bridged to viem in
   `client/src/lib/privy/wallet-client.ts`. Privy is chain-locked to Base
   Mainnet 8453 (`defaultChain`/`supportedChains` = `[base]` from
   `client/src/lib/chains.ts`).
2. **Agent custody — Circle Developer-Controlled Wallets.** SCA accounts on
   blockchain `"BASE"` (`server/src/lib/agent-wallet.ts`). The custody root is
   the Circle **entity secret** (`CIRCLE_ENTITY_SECRET`,
   `server/src/lib/circle/client.ts`), held only in the operator's
   env/secrets manager — never in code or the repo. Agent wallets are pinned
   to one wallet set (`CIRCLE_WALLET_SET_ID`; production refuses to create a
   set implicitly, `client.ts`) and gas is sponsored by a pinned Gas Station
   policy (`CIRCLE_GAS_STATION_POLICY_ID`,
   `server/src/lib/circle/sponsorship.ts`; production refuses unsponsored
   transactions).
3. **Segregation — the D-008 two-wallet boundary** (table above). No code
   path signs with or moves funds from the Privy wallet on the agent's
   behalf; funds cross the boundary only user → agent, and only with the
   user's signature on the Privy side. Each wallet carries its own
   server-enforced daily cap (`server/src/lib/spending-cap.ts`,
   `agent_wallets.daily_cap_usd`), and every agent write passes
   `server/src/lib/circle/execute.ts` + the `allowed-targets.ts` allowlist.
4. **x402 buyer EOA — a third, deliberately separate key** (D-106).
   `X402_BUYER_PRIVATE_KEY` (falling back to `MANTUA_ADMIN_PRIVATE_KEY`,
   `server/src/lib/x402-buyer.ts`) signs EIP-3009 payment authorizations
   only. It is neither the user's Privy wallet nor the Circle agent wallet,
   and x402 spend is bounded by its own caps (`X402_MAX_CALL_USD`,
   `X402_DAILY_CAP_USD`), not the agent wallet's.
5. **What Mantua never holds:** user private keys (Privy custody, item 1);
   a plaintext entity secret in code or the repo (env-only, item 2); any key
   that can cross the user→agent boundary in reverse.

## Mainnet safety rails (Phase 1)

Server-side enforcement primitives. Every Phase 3+ write path goes through these BEFORE any Trading API or PoolManager call.

| Rail                  | Module                                               | Hard ceiling           | Notes                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spending cap (P1-001) | `server/src/lib/spending-cap.ts`                     | $50,000/day per wallet | Reads from `user_preferences.daily_cap_usd` (primary wallet) or `agent_wallets.daily_cap_usd`. Per-day tracking in `daily_wallet_spend`. Reset at 00:00 UTC.          |
| Wallet age (P1-002)   | `server/src/lib/wallet-age.ts`                       | n/a                    | `recordFirstSeen` on first connection; `getWalletAge` returns `{ ageDays, tier, tierMaxCapUsd }`. Used by P1-003 cap-raise UI.                                        |
| Slippage (P1-004)     | `server/src/lib/slippage.ts`                         | 500 bps (5%)           | `classifySlippage(bps)` returns `ok` / `warn` / `double_confirm`. Above 500 bps throws `SafetyError`.                                                                 |
| Kill-switch (P1-006)  | `server/src/middleware/kill-switch.ts`               | n/a                    | Env `MANTUA_KILL_SWITCH=1` — all POST/PUT/PATCH/DELETE return 503. Reads + wallet connection unaffected.                                                              |
| Rate limit (P1-007)   | `server/src/middleware/rate-limit.ts`                | 100 req / 15 min IP    | Tighter `writeRateLimiter` and `walletRateLimiter` for chain-touching paths. Wallet keying activates after Phase 2 auth lands.                                        |
| Audit log (P1-008)    | `server/src/lib/audit.ts` + `mantua_audit_log` table | n/a                    | Every write attempt logged with `(action, outcome, wallet, params, tx_hash, reason, ip, user_agent)`. Distinct from `portfolio_transactions` (which is success-only). |

The hard ceilings live in `server/src/lib/constants.ts`. Lifting any of them requires a code change + redeploy — there is no admin path for them at runtime.

`SafetyError` (`server/src/lib/errors.ts`) is the canonical thrown type for rail violations. The error code (`spending_cap_exceeded`, `slippage_too_high`, etc.) is what gets logged into `mantua_audit_log.outcome` so reviewers can grep on it.

### Deferred UI tasks

Two Phase 1 tasks are explicitly deferred to Phase D, where the UI primitives exist:

- **P1-003 (tiered cap raise UI)** — needs a Shadcn confirmation modal (PD-005) and the cap-management screen layout (PD-004). The server-side primitives (`getWalletAge`, `getDailyCap`) are ready to back it; only the UI is missing.
- **P1-005 (mandatory transaction confirmation modal)** — superseded by Phase D's `useConfirmedAction` hook (see below).

Both deferrals are tracked in `docs/tasks/v2-roadmap.md` and revisited at the end of Phase D.

## Phase D — design system

The v1 prototype (`Mantua Prototype.html`) is the design spec. Phase D extracts it into a reusable system before feature phases build UIs on top.

| Artifact           | Path                                                          |
| ------------------ | ------------------------------------------------------------- |
| Constraint capture | `docs/design/notes.md`                                        |
| Token source       | `client/src/styles/tokens.css` (CSS vars)                     |
| Tailwind 4 binding | `client/src/index.css` (`@theme inline`)                      |
| Component mapping  | `docs/design/components.md`                                   |
| Shell scaffold     | `client/src/components/shell/{AppShell,Header,Logo,Card}.tsx` |
| Confirmation seam  | `client/src/hooks/use-confirmed-action.tsx`                   |
| Theme toggle       | `client/src/hooks/use-theme.tsx` (`html[data-theme]`)         |

### Deviations from the prototype

PD-007 — things the prototype shows differently from how v2 will ship, with rationale.

- **Responsive design.** The prototype hard-locks `<meta viewport width=1400>`. v2 must support mobile. Added our own breakpoints in `docs/design/notes.md`. Right-column slide-in sheet (mobile) lands as a Phase D follow-up when the first feature actually needs it.
- **Onboarding modal removed.** The four-screen welcome carousel from the prototype was dropped per design feedback (PR [#1](https://github.com/DelleonMcglone/Mantua-Intelligence/pull/1)). v2 lands users on the login screen directly. The login screen reuses the welcome modal's visual style.
- **Self-signed HTTPS in dev.** Privy needs a secure context. Added `@vitejs/plugin-basic-ssl`. Browser shows a one-time cert warning. (Documented earlier, not a Phase D-specific deviation.)
- **Focus-visible rings.** Prototype doesn't show keyboard focus. v2 adds a 2px accent-purple ring on every `:focus-visible` (in `client/src/index.css`) per WCAG 2.1 AA.
- **Density settings location.** Prototype exposes density in the Settings panel. v2 also persists it in the Settings panel; the underlying mechanism is `html[data-density]` driven by a `useTheme`-style hook (lands when the Settings panel is built, Phase 6).
- **Self-hosted fonts (planned).** Prototype + v2 currently load Inter + JetBrains Mono via Google Fonts. Phase 9 moves them to Vercel-edge fonts to drop the third-party fetch and tighten CSP.
- **Network dropdown shows only Base.** The prototype renders a multi-network picker; we render the same control for visual consistency, but only Base is selectable (chain-lock).

### Confirmation modal seam (P1-005)

The `useConfirmedAction` hook is the single architectural seam between any UI button click and an on-chain transaction. Every Phase 3+ write path MUST call `confirm()` and wait for user assent before executing. Lint rule incoming in Phase 9 to reject any direct call to swap/LP modules outside a confirmed-action context.

```tsx
const confirm = useConfirmedAction();
const ok = await confirm({
  title: "Swap 0.5 ETH for USDC",
  description: "Expected output: 1,815.42 USDC. Slippage 0.5%.",
  doubleConfirm: slippageBps >= 100, // P1-004 calls for double-confirm at ≥1%
});
if (!ok) return;
await submitSwap(...);
```

## AgentKit agent (`agent/` workspace)

Coinbase **AgentKit `0.10.4`** (TypeScript) agent on **Base Mainnet (8453)**
via `ViemWalletProvider`. Isolated as its own workspace so it can pin **zod
3.25.76** + **viem 2.38.3** (AgentKit-compatible) without disturbing the
server's zod v4 / viem 2.48.4. CDP-native action providers
(`cdpApiActionProvider`, `deploy_token`) are intentionally not registered — the
agent's surface is the small allowlisted action set below.

**Chain:** id `8453`, RPC `https://mainnet.base.org` (override via
`BASE_RPC_URL`), explorer `https://basescan.org` (BaseScan).

**Gas.** Base uses native ETH (18 decimals) for gas; token balances, transfers,
and ERC-8183 escrow use each token's ERC-20 interface (USDC/EURC 6 dp, cbBTC
8 dp). Unit helpers are centralized in `agent/src/lib/decimals.ts`, with
conversion tests both ways.

**Contract addresses** (loaded from env, never hardcoded in source):

| Standard | Contract                       | Address                                      | Source                                                           |
| -------- | ------------------------------ | -------------------------------------------- | ---------------------------------------------------------------- |
| ERC-8183 | AgenticCommerce (job + escrow) | env-driven, optional — no default            | Base Mainnet deployment pending — see `docs/tasks/v2-roadmap.md` |
| token    | USDC ERC-20 (6-dp)             | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Circle USDC contract addresses (Base)                            |
| token    | EURC ERC-20 (6-dp)             | `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` | Circle EURC contract addresses (Base)                            |
| token    | cbBTC ERC-20 (8-dp)            | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | Coinbase cbBTC contract addresses (Base)                         |

**Funding.** The agent wallet needs a little ETH for gas plus whatever token
budget the user allocates. The `check_balances` action warns on low gas.

**Assets allowlist.** USDC / EURC / cbBTC only (`agent/src/config/assets.ts`);
any other asset is rejected with a clear error.

## v2 reusability audit — keep/replace decisions (2026-09-02)

Five-area audit of the inherited v2 code after the Base Mainnet migration:
swap, liquidity, wallet layer, safety rails, design system. Each area was
read end-to-end with file:line evidence; verdicts are **KEEP** (production-
usable as-is), **REFACTOR** (usable after named changes), **REPLACE** (wrong
for mainnet), or **MISSING** (needs building). Effort is S/M/L.

### Swap module

The quote path is production-grade; the execution path is not — it was built
on `PoolSwapTest`, which does not exist on mainnet (`poolSwapTest: null`), so
every swap-execution entry point (user calldata route, agent swap, intents,
chat tool, rebalance) currently errors.

| Component                                                                                                                    | Verdict                  | Why                                                                                                                                                                                              | Effort |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| V4Quoter quote path (`quoteExactInputV4`, `resolveInitializedFee`, revert decoding, `readSlot0`/StateView, max-input search) | KEEP                     | Canonical live mainnet contracts; well-engineered caching and error decoding                                                                                                                     | S      |
| `buildPoolSwapTestCalldata` (`server/src/lib/v4-onchain-swap.ts:620`)                                                        | REPLACE                  | Target contract absent on 8453; no `amountOutMinimum`, no deadline. Replace with UniversalRouter `V4_SWAP` + Permit2 — both constants already declared in `v4-contracts.ts` but wired to nothing | M      |
| `/api/v4/swap/calldata` route + client `useSwap`                                                                             | REFACTOR                 | Route shape (server-side re-quote, min-out derivation) is right; swap the builder, add deadline, replace infinite-approve-to-test-router with bounded approve→Permit2                            | M      |
| `swapFromAgentWallet` guard chain                                                                                            | REFACTOR                 | Cap/ledger/audit scaffolding keeps; `slippageTolerance` is validated then silently dropped — no min-out on agent swaps at all                                                                    | M      |
| Hook-null fallback (`resolveHookAddress`)                                                                                    | REFACTOR                 | Silently substitutes the no-hook pool when a hook is undeployed; must fail closed and hide undeployed hook venues in the UI                                                                      | S      |
| Uniswap Trading API path (`lib/uniswap.ts`, `/api/quote`, `/api/swap/*`)                                                     | KEEP as no-hook fallback | Handles Permit2/slippage properly and indexes mainnet pools, but has zero client callers today — wire it or delete it, don't leave it registered-but-unreachable                                 | S      |
| 8 dead client swap components (~456 LOC, incl. the never-wired `SlippageInput` — slippage is hardcoded 50 bps)               | REPLACE (delete)         | Zero importers                                                                                                                                                                                   | S      |
| CCTP bridge venue                                                                                                            | KEEP                     | Only execution path that works on mainnet today; all-mainnet destinations                                                                                                                        | —      |

### Liquidity module

The calldata layer is genuinely production-grade — real
`PositionManager.modifyLiquidities` multicalls with Permit2, correct v4 fee
accounting, no test routers anywhere. The data layer around it has three hard
mainnet blockers.

| Component                                                                                                                                                       | Verdict               | Why                                                                                                                                                                                                          | Effort |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Add/remove/collect calldata builders, v4 action encoding, pool-key/tick/liquidity math, Permit2 helpers, accrued-fees math                                      | KEEP                  | Correct against v4-periphery; the strongest code in the app                                                                                                                                                  | —      |
| On-chain position discovery (`ownedTokenIds`)                                                                                                                   | REPLACE               | Sequential `ownerOf` sweep of tokenIds 1–2000 can never find a real user position on the canonical mainnet PositionManager; replace with subgraph/`Transfer`-log/NFT-index discovery, keep `readOnePosition` | M      |
| `poolKeyHash` (3 divergent formulas across add-route, pool-create, external-positions)                                                                          | REFACTOR              | Hashes never match, so no `positions` DB row is ever written — user and agent position tracking silently dead. One shared helper; highest value-per-effort fix in the module                                 | S      |
| `IS_MAINNET` data-source fork in Positions UI                                                                                                                   | REFACTOR              | Permanently-true flag routes the UI to the broken DB path and dead-codes the authoritative on-chain reader; delete the fork                                                                                  | M      |
| Pool discovery (DefiLlama listing + translator + hook inference)                                                                                                | REPLACE (longer-term) | Returns thousands of mixed v2/v3/v4 Base pools, top-50 reachable, hook binding _guessed_ from (pair, fee); move to the v4 subgraph's real PoolKeys                                                           | L      |
| `AddLiquidityForm` fee handling                                                                                                                                 | REFACTOR              | `ctx.fee` silently discarded → joining a 0.05% pool creates and seeds a brand-new 0.30% pool with real money; honor the fee and gate pool creation behind an explicit confirm                                | M      |
| `RemoveLiquidityModal` success callback (stale closure), placeholder position values, localStorage pools/positions as source of truth, ~350 LOC dead components | REFACTOR / delete     | Breadcrumb overlay logic keeps as the post-mint RPC-lag shim only                                                                                                                                            | S–M    |

### Wallet layer

Circle's `"BASE"` blockchain enum is verified correct against the installed
SDK. The custody split is: user wallets non-custodial via Privy (correctly
locked to Base at the SDK boundary — KEEP), agent wallets Circle DCW with the
entity secret as full custody.

| Component                               | Verdict          | Why                                                                                                                                                                                                                               | Effort |
| --------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Privy config/provider                   | KEEP             | Single-chain lock enforced at the SDK boundary                                                                                                                                                                                    | —      |
| `hardenProvider` (client tx path)       | REFACTOR         | Good design; uses legacy `gasPrice` on an EIP-1559 chain (no fee ceiling) and a silent catch that falls back to the rate-limited path                                                                                             | M      |
| `chain-context.tsx`                     | REPLACE          | ~120 of 159 lines provably unreachable single-chain; `useChainSwitch` has zero consumers; collapse `useCurrentChainId` to a constant                                                                                              | S      |
| Circle `execute.ts`                     | REFACTOR         | **Ship-blocker:** returns success at Circle state `SENT` — a reverted tx is reported as success, spending is recorded, audit says "success". Also causes the approve/execute race every agent flow has. Poll to confirmed receipt | L      |
| Circle `client.ts` wallet-set bootstrap | REFACTOR         | **Ship-blocker:** unset `CIRCLE_WALLET_SET_ID` mints a new wallet set per serverless cold start, outside any Gas Station policy. Must throw in production                                                                         | S      |
| Gas Station sponsorship                 | MISSING          | Code assumes sponsored gas everywhere; no policy configuration exists anywhere, no ETH-balance preflight, no distinct "agent wallet has no gas" error                                                                             | M      |
| `allowed-targets.ts`                    | KEEP             | Best security code in the layer; fix the process-global `registerDynamicTargets` set leaking across warm-instance requests                                                                                                        | S      |
| `agent/` workspace                      | REPLACE / delete | Orphaned (zero importers) second custody model holding a raw `AGENT_PRIVATE_KEY` hot key that bypasses every rail; do not ship to mainnet — delete, or port the ERC-8004/8183 providers onto the Circle rails                     | S–L    |
| Approval hygiene                        | REFACTOR         | Agent wallet grants infinite Permit2/PositionManager approvals with ~permanent expiry; bound agent-side approvals                                                                                                                 | M      |
| `auth.ts` middleware                    | REFACTOR         | Uncached Privy round-trip per request; nondeterministic wallet pick when a user has embedded + external wallets (keys the cap ledger)                                                                                             | M      |

### Safety rails

The load-bearing distinction: agent wallets are server-signed, so server
checks are real rails; user wallets are self-custodied, so server checks on
that path are advisory UX, not controls.

| Rail                                                 | Verdict                       | Why                                                                                                                                                                                                                                                                                                  | Effort |
| ---------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Agent-wallet spending caps                           | KEEP + 2 fixes                | Enforced at every server-signed execution point. **Critical hole: the chat LLM tool `set_cap` bypasses the route's zod clamp — the agent can raise its own daily cap $100 → $50,000 with no user assent.** And `tokenAmountUsd` fails open to $0 on price-feed outage, disabling the cap system-wide | S      |
| User-wallet spending caps                            | REPLACE (or relabel advisory) | Checked only on `/api/quote`; calldata routes skip it; ledger increments only via a client-reported endpoint; user holds the keys                                                                                                                                                                    | L      |
| Uncapped money paths                                 | MISSING                       | Sports market trades, user add-liquidity/pool-create, `/api/v4/swap/calldata`, and Gateway spends (which check a counter they never increment) have no cap and mostly no audit                                                                                                                       | M      |
| Tier system (age-based caps)                         | REPLACE                       | `getWalletAge` has zero callers — the documented D-009 policy is entirely unimplemented; a day-one account can be set to $50k                                                                                                                                                                        | S      |
| x402 caps                                            | KEEP                          | Server-keyed, per-call + daily, conservative defaults                                                                                                                                                                                                                                                | —      |
| `MANTUA_KILL_SWITCH`                                 | REFACTOR                      | Gates only POST/PUT/PATCH/DELETE — **all seven GET cron money-loops (rebalance, intents, strategies, resolution, sweeps) keep running with the switch on.** Flipping requires a full redeploy. Move to a per-request DB/Edge-Config read, cover GET, and check it inside `executeAgentCalldata`      | M      |
| `STRATEGIES_KILL_SWITCH`                             | KEEP                          | Correctly scoped, actively disarms, audited                                                                                                                                                                                                                                                          | —      |
| Rate limiting                                        | REFACTOR                      | Right layering, wrong store: in-memory counters are per-lambda on Vercel and reset on cold start; needs Redis/Upstash                                                                                                                                                                                | M      |
| Cron/admin auth                                      | REFACTOR                      | One shared secret unlocks settlement, sweeps, and admin ops; non-constant-time compare; `MANTUA_FEE_ADMIN_KEY` is declared/documented but read by zero code (MISSING)                                                                                                                                | S      |
| `/api/rpc` proxy                                     | REFACTOR                      | Method allowlist is good, but open CORS + allowlisted `eth_sendRawTransaction` = free public tx relay                                                                                                                                                                                                | S      |
| Audit log                                            | REFACTOR                      | Right schema and ~30 call sites, but inserts fail silently, `rejected_kill_switch`/`rejected_chain` outcomes are never emitted, market trades write no rows, no user-id/request-id correlation, no integrity/retention controls                                                                      | M      |
| Slippage enforcement                                 | REPLACE                       | `MAX_SLIPPAGE_BPS` unapplied on the v4 path (accepts 100%); min-out is display-only, absent from calldata on both user and agent paths — land it with the UniversalRouter migration                                                                                                                  | M      |
| Allowed-targets, hook-pair gating, peg/impact guards | KEEP                          | Server-side, default-deny, enforced in code not prompt; the attested-`force`-override pattern is the model to reuse for cap raises                                                                                                                                                                   | —      |

### Design system

Foundation worth keeping; component layer is scaffolding. The token/theme
layer (Tailwind 4 `@theme`, dark/light inversion, theme provider, global
focus-visible) is solid. Above it: 3 primitives built of 10 planned, 32 files
of raw `<button>`, 5 hand-rolled dropdowns, 2 ARIA-free tab systems, 6
divergent USD formatters, and a parallel inline-style component library in
`features/agent/` (ported verbatim from a design file that is not in the
repo) whose hardcoded dark-theme rgba values render the wrong hue in light
mode.

| Area                                                              | Verdict                                                                                                                                                                                                               | Effort |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Token/theme system (`tokens.css`, `index.css`, `use-theme`)       | KEEP — delete the dead Shadcn alias block + 4 dead tokens, self-host fonts                                                                                                                                            | S      |
| Type scale                                                        | REFACTOR — 349 arbitrary `text-[Npx]` across 20 sizes; name ~7 tokens, codemod, lint rule                                                                                                                             | M      |
| `ui/button`                                                       | REFACTOR — radius set per-size collides with the pill variant; `size="sm"` renders square                                                                                                                             | S      |
| `ui/dialog`                                                       | KEEP — but `LoginModal` (the primary auth surface) bypasses it with no focus trap / role / aria-modal → REPLACE its shell                                                                                             | S      |
| Missing primitives (dropdown, tabs, skeleton, toast, empty-state) | REPLACE hand-rolled copies — this is where the a11y debt lives                                                                                                                                                        | L      |
| Accessibility                                                     | **Zero `aria-live`/`role="alert"` in the entire client** — no error, loading, or tx result is ever announced; no tab semantics; mouse-only token picker. The one user-facing defect class in this area                | M      |
| Agent-surface styling idiom                                       | REPLACE — consolidate onto Tailwind+tokens; promote `Banner`/`Skel`/`TxRow` into `components/ui/`                                                                                                                     | M      |
| Number/currency formatting                                        | REPLACE — one `lib/format.ts`; six divergent USD formatters is a trust bug in a financial product                                                                                                                     | S      |
| Prototype tracking                                                | REPLACE the reference — the app has outgrown `Mantua Prototype.html`; cited design sources (`Mantua Agent Flows.html`) are not in the repo; declare the built app the spec or commit the sources as frozen provenance | S      |

**Correction to P1-005 above:** the "single seam" claim no longer holds — the
agent chat is a second, deliberate path from user input to on-chain
transaction that never calls `confirm()` (it acts autonomously within the
cap). The seam stays mandatory for _user-signed_ writes; the agent path's
control is the cap + allowlist + guard stack, not the modal. Recorded here
until a decision record formalizes it.

### Ship-blockers before real volume (ranked)

1. Circle `execute.ts` — confirm to mined receipt, not `SENT` (fixes silent-revert-as-success, the approve/execute race, and cap-ledger drift in one change).
2. Chat `set_cap` tool — clamp through the route's zod schema; gate raises behind the attested-override pattern.
3. UniversalRouter/Permit2 execution builder with real `amountOutMinimum` + deadline; enforce `MAX_SLIPPAGE_BPS`; fail closed on null hooks.
4. Kill switch — cover GET crons, make it flippable without a redeploy, check inside `executeAgentCalldata`.
5. Pricing fail-open — a $0 valuation must reject, not pass the cap.
6. `CIRCLE_WALLET_SET_ID` — hard-fail when unset in production; verify a mainnet Gas Station policy exists for the wallet set.
7. `poolKeyHash` unification + position-discovery replacement (positions/earnings surfaces are otherwise empty or wrong on mainnet).
8. Delete or port the orphaned `agent/` workspace — no raw hot key ships to mainnet.

## Polymarket conventions survey (2026-09-03)

End-to-end read of docs.polymarket.com (via its llms.txt page index; source
URLs inline). Venue divergence from Mantua is total — Polygon / ERC-1155 CTF
tokens / CLOB / pUSD collateral vs Base / ERC-20 outcome tokens / Uniswap v4
AMM / native USDC — but the _economic_ conventions transfer intact. Verdicts:
**adopt** (use as-is), **adapt** (translate to the AMM design), **N/A**.

### Market economics — the invariants worth adopting

| Convention                                                                                                                                                                                   | Source                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every YES/NO pair is backed by exactly $1 of locked collateral; split ($1 → 1 YES + 1 NO), merge (pair → $1, "exit without trading"), redeem ($1 per winning share, pull-based, no deadline) | concepts/positions-tokens.md                   | **Adapt — highest-leverage item.** Two independent v4 pools can price YES+NO ≠ $1 with no correcting force; the split/merge arb path is the enforcement mechanism. Implement split/merge/redeem on Mantua's ERC-20 pairs even though the venue differs. Keep split/merge out of mainstream UI (Polymarket barely surfaces it).                                                                                                                                                                                                                             |
| Price IS probability, $0.00–$1.00; YES + NO sum to $1 (enforced at match time by mint/merge, not decree)                                                                                     | concepts/prices-orderbook.md                   | **Adopt** for display; report spot probability normalized pYES/(pYES+pNO), raw pool prices separately.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Invalid/void outcome: "market resolves 50/50 — each token redeems for $0.50"                                                                                                                 | concepts/resolution.md                         | **Adopt** — this is exactly what Mantua's INVALID state should pay (postponed/abandoned games); preserves the $1-per-pair invariant.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| One canonical display price with a documented fallback (midpoint; last trade when spread > $0.10; "0.5" placeholder for never-traded)                                                        | concepts/prices-orderbook.md                   | **Adapt** — AMM spot is the midpoint analogue; document the stale/empty-pool fallback; use the 0.5 placeholder for capture-less markets.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Taker fee = C × rate × p × (1 − p), sports rate 0.05; symmetric, maximal at 50¢, vanishing at extremes                                                                                       | trading/fees.md                                | **Adapt** — a flat AMM fee is proportionally brutal on longshots (1¢ on a 3¢ share ≈ 33%). The p(1−p) curve is implementable as a v4 dynamic-fee hook; 0.05 is a documented sports calibration point.                                                                                                                                                                                                                                                                                                                                                      |
| Sports in-play defense: outstanding orders cleared at game start (`clearBookOnStart`); live orders wait a configured `secondsDelay` before matching                                          | concepts/markets-events.md, order-lifecycle.md | **Superseded by D-103** — this row originally read the `clearBookOnStart` convention as validating Mantua's freeze-at-kickoff. In-play trading shipped instead (2026-09-06): markets trade before **and** during the event and close on final, with a 12 h permissionless backstop. Mantua's live-play defence is priced, not gated — the hook's dynamic fee / per-trade cap / stale-keeper clamp, plus the server's in-play quoting halt on a stale feed. A disclosed commit delay remains the unbuilt alternative if the fee ladder proves insufficient. |
| Resolution pipeline (UMA optimistic oracle: $750 bond, 2-hour challenge, escalating disputes)                                                                                                | concepts/resolution.md                         | **N/A on mechanism** (Mantua resolves server-signed), **adapt three conventions**: a sanity window between RESOLVED and SETTLED before redemptions open; a signer-enforced can't-resolve-before-gameStartTime check; user-visible pipeline states (Trading → Result in → Resolved → Claimable).                                                                                                                                                                                                                                                            |
| Negative-risk groups for mutually exclusive outcomes ("exactly one resolves Yes"); NO-in-one ↔ YES-in-all-others conversion                                                                  | concepts/negative-risk.md                      | **N/A for binary v1.** If 3-way soccer ships: three linked binary markets with the exactly-one-YES invariant enforced server-side; the conversion mechanic needs shared collateral and doesn't map to per-outcome AMM pools.                                                                                                                                                                                                                                                                                                                               |
| Market lifecycle is flags (`active/closed/archived/acceptingOrders/restricted/live/ended`), and markets exist before trading opens and stay queryable after close                            | market-data/market-details.md                  | **Adapt** — Mantua's OPEN/FROZEN/RESOLVED/SETTLED/INVALID enum is cleaner; borrow: `gameStartTime` distinct from endDate, a per-market `restricted` geo flag, and decoupling API existence from pool deployment.                                                                                                                                                                                                                                                                                                                                           |

### API conventions

- **Price history grammar (adopt verbatim for `/api/markets/:id/prices`):**
  `interval` presets (`1h|6h|1d|1w|max`) XOR absolute `startTs`/`endTs`
  (never combined), plus `fidelity` (sampling interval in minutes) for
  server-side downsampling; compact response `{history: [{t, p}]}`. Maps
  1:1 onto `market_prices` (t = captured_at, p = implied_probability).
  (market-data/prices-order-books.md)
- **Singular GET + plural POST batch** for hot reads (`/price` + `/prices`
  with an id array → keyed map, batch cap ~500). Batch endpoints are also
  Polymarket's de facto rate-limit relief valve. (same source)
- **Ids and slugs:** every market object carries all of its identifiers
  (numeric id, slug, on-chain id, per-outcome token refs) so clients never
  need a mapping call; dedicated `/slug/{slug}` routes for every
  discoverable entity; accept each id type as a list filter. Anti-pattern
  to avoid: Polymarket reuses the param name `market` for different id
  types across endpoints — one name per id kind, stable across REST and WS.
- **Pagination:** offset + `order`/`ascending` for UI pages; keyset
  (`limit`/`after_cursor` → `{next_cursor, hasMore}`) for feeds and
  crawlers; `after`/`before` time filters on trade-like listings. Use
  `next_cursor: null` as the terminal marker (skip Polymarket's magic
  `LTE=` string) and standardize one envelope (they ship three).
- **Filters vocabulary** (list-markets/list-events): `closed=false` by
  default, min/max liquidity & volume thresholds, date ranges, id arrays,
  `game_id`, `sports_market_types[]`. (api-reference/markets/list-markets)
- **Errors:** `{error, code?, retry_after_seconds?}` envelope; 429 with
  documented exponential-backoff guidance; 503 with a human operational
  message for paused/degraded states. (resources/error-codes.md)
- **WebSocket market channel (the pattern for real-time prices):** one
  public socket; subscribe with an id array; dynamic
  `{operation: subscribe|unsubscribe}` without reconnect; `event_type`-
  discriminated messages; snapshot-on-subscribe then deltas; lifecycle
  events (`new_market`, `market_resolved`); documented PING/PONG (10s).
  User channel: separate socket, credentials in the first frame, same
  subscription grammar. (market-data/realtime-data.md)
- **Auth layering** (when authed endpoints ship): wallet EIP-712 signature
  proves ownership once and mints revocable API credentials; hot paths
  never touch the key; public market data stays unauthenticated. A signed
  session token achieves the layering without their five-header HMAC.
  (trading/wallets-auth.md)
- **Tx-status ladder** for swap endpoints/WS: pending → mined → confirmed
  (terminal) / failed, with terminal-ness documented per status.
- **Publish an OpenAPI spec** (and llms.txt): Polymarket ships machine-
  readable specs for every service and it materially eases integration.
- Serialize money/prices as **decimal strings**; one timestamp format
  (their ISO/unix-s/unix-ms mix is the thing not to copy).

### Data-model conventions (Gamma)

- **Event = game, markets nested under it** — event responses embed
  `markets[]`; the single most load-bearing discovery ergonomic. Volume/
  liquidity roll-ups (24h/1wk/1mo windows) and `commentCount` are
  **denormalized onto the event** so list pages are one query. Live sports
  state (`score, elapsed, period, gameStatus`) lives on the event, not the
  market. (api-reference/events/list-events)
- **Sports metadata endpoints:** `/sports` (league code, image, official
  resolution-source URL, home/away display ordering), `/teams?league=`,
  `/sports/market-types`; `game_id` joins events↔games — identical in
  spirit to Mantua's provider-keyed events. Per-sport resolution-source URL
  feeds the market page's Rules section. No player/injury endpoints exist —
  Mantua's players/injuries tables go beyond Polymarket. (api-reference/sports/\*)
- **Comments:** polymorphic parent (`parent_entity_type` ∈ Event/Series/
  market + id) — better than Mantua's current provider-event-id keying;
  `parentCommentID` single-level threading; `holders_only` filter and
  commenter-position badges ("skin in the game") are cheap, proven
  engagement features. (api-reference/comments/list-comments)
- **Positions API field set:** size, avgPrice, curPrice, initialValue,
  currentValue, cashPnl, percentPnl, `redeemable`/`mergeable` flags;
  closed positions carry realizedPnl. Adopt for Mantua's portfolio
  endpoint. Activity: typed enum (TRADE/SPLIT/MERGE/REDEEM/DEPOSIT/…) —
  matches the new `activity.kind`. Holders per outcome token; leaderboard
  keyed (category, timePeriod, orderBy PNL|VOL) with a single-user rank
  lookup. (market-data/public-analytics.md, trading/wallet-activity.md)
- **Combos:** Polymarket prices parlays via an RFQ auction (maker quotes
  in 400 ms, 10 s acceptance) — N/A for an AMM — but their combo _data
  model_ (combo id + `legs[]` each carrying market ref, outcome, price,
  per-leg resolution; USDC amount/payout) matches Mantua's schema-only
  `combos`/`combo_legs` tables. (trading/combos/overview.md)

### UX conventions

- Price-as-probability display with the $1-payout frame ("buy at 40¢ →
  $1/share if right"); present YES/NO as complements summing to $1.
- **Buy in dollars, sell in shares** — asymmetric on purpose; maps to
  exact-input swaps. Surface price impact prominently (an AMM always
  fills, at worsening prices — a hazard Polymarket's CLOB docs don't have).
- **"Exit anytime"** framing on every position row — the differentiator
  vs sportsbooks.
- Market page: stats block (price, 24h volume + change, liquidity, end
  date, game start time), **Rules/resolution-source section front and
  center** ("the title describes the question, the rules define how it
  resolves"), comments, top holders (as handles — never raw addresses,
  per the chainless rule).
- Portfolio: positions with avg cost / current value / $ and % P&L and a
  "Claim winnings" state; typed activity feed (suppress tx hashes per
  chainless branding — receipt-style entries instead).
- Polymarket itself leans chainless (prices in dollars, "pUSD" branding,
  no chain names in product copy) — external validation of Mantua's
  chainless positioning.
- Unverified in official docs (check the live app before treating as
  convention): the "¢" glyph itself, chart timeframe set, comment/holder
  tab layouts, related-markets module, disputed-state visuals, embeds.

### Explicitly not copied

Order-book machinery (order types, tick sizes, maker/taker split, resting
orders, heartbeats), UMA oracle plumbing, pUSD wrapper (native USDC stays),
ERC-1155 CTF (ERC-20 pairs stay), neg-risk adapter contracts, stringified-
JSON array fields, mixed timestamp formats, three separate API base URLs.

## Deposit → Trade → Withdraw (C-011)

The only mental model a user needs: **USDC in, tradeable balance, USDC
out.** Everything is denominated in USDC — balances, positions, stakes,
payouts, fees, caps (C-004; audit: `docs/tasks/023-usdc-denomination-flow.md`).
Each leg of the story, mapped to the code that implements it:

**Deposit.** The user funds a wallet with USDC. Two receiving wallets
exist: the user's own wallet (address on the profile page,
`client/src/features/portfolio/ProfilePage.tsx`) and the agent's wallet
(address handed out by the agent chat and shown in the Agent panel with a
copy button — funding guidance lives in the `agent-chat.ts` system
prompt). Both are funded the same way: send USDC to the address. The
agent can further consolidate its USDC into a unified treasury balance
(`POST /api/agent/unified-balance/deposit`).

**Trade.** Buys spend USDC for outcome tokens; sells return USDC. One
builder serves every caller
(`server/src/lib/sports/market-trade-build.ts`): the market page's trade
sidebar (`use-market-trade.ts` → `POST /api/markets/trade/calldata`,
signed by the user's wallet) and the agent's `trade_market` tool plus the
strategy executor (`server/src/lib/sports/market-agent-trade.ts`, signed
by the agent's wallet, cap-checked, fees sponsored). A winning position
redeems 1 USDC per token; a void settles at 0.50. Open positions are
marked in USDC (`/api/markets/positions`, portfolio "Market positions").

**Withdraw.** USDC leaves the same way it came in. From the agent
wallet: the chat's `send` tool or `POST /api/agent/send` transfers USDC
to any address the user names — their own wallet included — cap-checked
and confirmed on a receipt; the treasury balance can also settle out via
`POST /api/agent/unified-balance/spend` or the bridge tool. From the
user's own wallet there is currently no in-app send (GAP-4 in the task
doc), and post-resolution redemption has no user-facing path (GAP-3) —
the two named holes in the arc; the remaining legs exist end-to-end.

Gas is the one non-USDC residue (user-signed trades pay it natively;
agent-side operations are already sponsored) and is being removed by the
gasless task, after which the model above is exact.

## Consumer trading layer (Phase 6, task 050)

The consumer layer sits on the market stack without touching the
mechanism, the fee model, or the execution path. Its rule: every product
principle is a pure module with a test, and the components only render
what those modules return.

- **Discovery** (`client/src/features/markets/discovery.ts`,
  `discover/DiscoverPage.tsx`, `server/src/routes/market-discover.ts`).
  One `DiscoverFilters` object — sport, league, team, game, status, start
  window, liquidity floor, sort — produced by the filter chips, by the
  natural-language path (`discovery-query.ts`, behind `chat-intent.ts`'s
  `discover` intent), and by the dock's Trade chip. The server read joins
  the public slate (with live pool odds) to the latest pool tick's
  liquidity (`2·L·√p`, the value of a full-range position) and 24 h fill
  volume/count; it is keyed by league + provider event id and never
  carries a market id or address (T-020). Adding a sport is a `SPORTS`
  row plus the server allowlist entry — no navigation layer.
- **The ticket** (`features/markets/ticket/`). `trade-ticket-core.ts` is
  the tap machine: price → preset → Confirm is three taps for a buy,
  Close → Confirm two for an exit, asserted in tests (T-002/T-011).
  `use-trade-ticket.ts` composes it with `useMarketTrade`, the shared live
  balance, and `trade-errors.ts`; the review block renders `feeLines` from
  the hook's quote in every season, and `feeExceedsCeiling` refuses a
  quote above 0.70% instead of rendering it (T-008). Execution ends in
  `TicketExecuted` (T-006). A short balance opens `TicketFunding` inline:
  bank via the shipped Plaid rail (`PlaidLinkLauncher`, shared with the
  Cash tab) or a USDC transfer, with Skip for USDC-native users (T-013).
- **Chainless surface.** `chainless-copy.test.ts` sweeps every user-facing
  string in the market surfaces and the shell chips for gas / ETH /
  network / chain / explorer words and raw addresses (T-004/T-005). The
  wallet's own prompts are the only place "your wallet" appears.
- **Provenance and freshness.** `probability-source.ts` labels every
  probability as market price, projection, or agent estimate (T-021);
  `PredictionNote` sits under agent and analysis output (T-022);
  `freshness.ts` + `Freshness` stamp every live-data surface from the
  slate's `fetchedAt` / `dataAsOf` / `delayed` (T-023).
- **Conversation first.** The dock `InputBar` stays the primary surface
  on every page (T-015). `lib/quick-actions.ts` maps the current route and
  the game in view to Analyze / Trade / Swap / Add Liquidity / Portfolio /
  Agent chips whose commands go through the same `handleCommand` and are
  proven to re-detect to their intent (T-016/T-017). Position commands
  carry a team hint that `team-select.ts` resolves against the slate.
- **Live updates.** `use-live-balance.ts` is a module-level store — one
  poll, refreshed on `mantua:refresh-portfolio` — read by the ticket and
  the portfolio; positions lists refresh on the same event plus a slow
  poll (T-007).
- **E2E.** `consumer-loop.e2e.test.ts` composes Discover → Analyze →
  Trade → Monitor → Exit/Settle through these modules against the
  server's wire shapes. The live on-chain run waits on the D-112 deploy.

## Decision log

See `docs/decisions/v2-open-decisions.md` for the per-decision reasoning and `docs/tasks/v2-roadmap.md` for the locked task list.

### Dynamic Market Hook (spec §43)

Spec: `docs/specs/dynamic-market-hook.md`. Code:
`contracts/src/hooks/dynamic-market/`. Review:
`docs/security/dynamic-market-hook-review.md`. Deploy:
`deploy/dynamic-market/`.

The eight questions §43 requires answering:

1. **One hook instance across many markets.** v4 allows one hook per pool key,
   but nothing requires one hook _contract_ per pool. Every prediction market
   needs identical logic, so a per-market deployment would mean mining a fresh
   CREATE2 salt and verifying a fresh contract for every game — hundreds a
   season — with no behavioural difference. One instance, state keyed by
   `PoolId`, is the same code path for all of them.

2. **State keyed by `PoolId`.** It is the value v4 already derives from the pool
   key and passes to every callback, so no lookup table or reverse mapping is
   needed. Using the market id instead would require the hook to translate
   pool → market on every swap.

3. **The keeper cannot control pricing.** It writes exactly three fields —
   model probability, confidence, event state — and every other input is derived
   on-chain from the pool and the block. Probability comes from `sqrtPriceX96`,
   not from the keeper. This is the "agent proposes, protocol enforces" split
   (§2.1): the model's opinion enters as a _risk premium_ weighted by its own
   stated confidence, never as the price.

4. **Risk bounds are immutable.** `MIN_RATE`, `MAX_RATE` (0.70%, per D-105
   — formerly `BASE_FEE`/`MAX_FEE`), `ABS_MAX_TRADE`, `MIN_TRADE_CAP` are
   `constant` in a library, not storage, so there is no setter to protect
   and no governance path to compromise. An attacker holding every key still
   cannot charge above the ceiling or lift the size cap. Storage plus an
   owner check would have made those the same class of risk as the keys.

5. **The close is state-driven, with a timestamp backstop.** _Superseded by
   D-103 (2026-09-06) — see `docs/decisions/v2-open-decisions.md`._ This item
   originally argued that kickoff protection must be timestamp-driven, because
   a crashed or lagging keeper at kickoff would leave a started game tradeable
   against people who can see the field. That hazard was accepted, not
   refuted: the owner decided in-play trading, so a started game **is**
   tradeable by design, and the live-play defence moved to the hook's
   degradation ladder (dynamic fees, per-trade caps, and the stale-keeper
   clamp to `MAX_FEE` / `MIN_TRADE_CAP`) plus the server-side quoting halt on
   a dark feed (P-012) — priced and sized, not forbidden. What survives from
   the original argument is its real point, that a close must not depend on
   keeper liveness: the halt is the keeper's `FINAL` write, and
   `kickoff + MAX_EVENT_DURATION` (12 h) is a keeper-independent backstop that
   fires with no keeper write at all, matching `Market.MAX_EVENT_DURATION` so
   the hook halts swaps at the same instant `freeze()` turns permissionless.
   The kickoff timestamp itself is unchanged: registration is once-only and
   there is no kickoff setter, so nobody can push the backstop out either.

6. **Stale keeper state fails closed, not shut.** Past `STALE_AFTER` the
   playoff rate clamps to `MAX_RATE` and the cap to `MIN_TRADE_CAP`, and the
   model-deviation premium drops out (a regular-season pool stays at 0%). Reverting instead would let keeper downtime brick a live
   market, turning an availability problem into a total loss of access;
   ignoring staleness would price against numbers nobody is maintaining.
   Expensive-but-open is the middle, and LPs are compensated for the
   uncertainty while it lasts.

7. **LP removal stays open during a halt.** The hook has no
   `BEFORE_REMOVE_LIQUIDITY` permission, so the callback does not exist. A halt
   is a statement about _trading_, not about custody: trapping LP capital
   because a game was postponed would make providing liquidity a strictly worse
   bet, and there is no risk it mitigates — an exiting LP takes no directional
   position.

8. **Fee, size cap, halt — and nothing else.** These three need no changes to
   the AMM curve, no custody of funds, and no new accounting, so they are
   auditable in isolation. Curve modification, liquidity provisioning, and LP
   incentives all touch value flow directly and would each need their own
   invariants; bundling them into the first deployment would have meant shipping
   an unreviewable surface for a market that has not traded yet.

**Deviations from spec §30:** nine files rather than seven — `MarketFlow.sol`
was extracted to keep every file inside the 150-line limit, and
`MarketFeeFormula.sol` (D-105) isolates the fee formula so spec-to-code
compliance can be checked against one 70-line library. The Nezlobin
directional _shape_ is reused from the dynamic-fee hook, but not its code: that
library keys off an oracle-deviation zone, and a prediction market has no
external reference price to deviate from, so the analogue is the pool's own
imbalance.

### Dynamic Market Hook fee model (D-105, task 049)

Spec: the owner's fee model (2026-09-11), recorded as **D-105** in
`docs/decisions/v2-open-decisions.md` and superseding spec §16–§18, §27,
§29 and §34 of `docs/specs/dynamic-market-hook.md`. Code:
`MarketFeeFormula.sol`, `MarketFeeCalculator.sol`, `RiskPolicy.sol`. User
page: `docs/fee-model.md`. Review: `docs/security/dynamic-market-fee-review.md`.

1. **Why the hook returns `rate × (1 − p)` and not `rate × p × (1 − p)`.**
   The formula `Fee = C × rate × p × (1 − p)` is stated per contract, but
   Uniswap v4 charges the LP fee as a fraction of the swap's gross input.
   Dividing the per-contract fee by the contract's value `p` gives the pip
   rate on the input, and with `C` defined as the contract-equivalent of the
   gross input at the pre-trade price the equality is exact in every swap
   shape — USDC in, YES in, exact-in, exact-out. Charging `rate × p × (1 − p)`
   on the input instead would have under-charged every trade by a factor `p`.

2. **Why the season flag is per pool and write-once.** The NFL and WNBA
   calendars overlap, so a global "playoffs" switch would be wrong for one
   league at a time; a game's phase is known when its market is created;
   and a flag no key can flip cannot be used to turn fees on against
   traders mid-market. It rides `registerPool` next to the kickoff
   timestamp, which is immutable for the same reason. Unknown season data
   defaults to the fee-free regular season.

3. **Why the ceiling is a `constant`.** As with `MAX_FEE` before it: no
   storage, no setter, no governance path, so an attacker holding every key
   cannot exceed 0.70%; lifting it is a redeploy and a new hook address.

4. **Why the rate has four bounded drivers with shares summing to 100%.**
   Each driver (liquidity, volatility, activity, uncertainty) owns a quarter
   of the 0.60% headroom, so a calm, deep, agreed, pre-game market pays
   exactly the floor and only every driver at maximum reaches the ceiling.
   Bounded shares are what make the manipulation analysis tractable: an LP
   pulling all liquidity, a whale leaning on one side, a griefer thrashing
   the price, or a rogue keeper can each move the rate by at most their
   share, never below the floor, and never outside the band.

5. **Why the quote is a view on the hook.** `quoteFee` runs the same
   private pricing path as `beforeSwap`. The server's trade build calls it
   and the UI prints Position / Estimated fee / Total from that number; the
   TypeScript mirror of the formula exists only to turn pips into token
   amounts for display and telemetry, and is pinned to the Solidity library
   by a shared vector file both test suites read.

6. **Why fee telemetry comes from the receipt, not the client.** The fills
   route already verifies the transaction receipt before believing a fill;
   the hook's `MarketFeeUpdated` log in that receipt is the only source the
   fee columns accept, filtered to the deployed hook address, so a client
   cannot report a fee it did not pay.

### Sports pivot (DM-101 … DM-112)

Reasoning and rejected alternatives: `docs/decisions/sports-pivot-decisions.md`.
Task list: `docs/tasks/sports-pivot.md`. Closed 2026-08-16 unless noted.

| ID     | Decision                   | Outcome                                                                        | Rationale (short)                                                                                                                                                                                       |
| ------ | -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DM-101 | Market mechanism           | Outcome-token AMM — YES/NO ERC-20 against USDC in v4 pools                     | Reuses the existing pool/hook/routing stack; gives the hook a lifecycle to attach to; price maps to implied probability                                                                                 |
| DM-102 | Conditional token standard | Purpose-built binary ERC-20 pair per market, USDC-collateralised 1:1           | Binary moneylines need two outcomes; ERC-20 drops into v4 and existing balance code without shims                                                                                                       |
| DM-103 | Resolution authority       | **OPEN** — needs owner sign-off                                                | Trust model, not an implementation detail; reaches into Terms and Market Integrity                                                                                                                      |
| DM-104 | Chain                      | Base Mainnet (8453)                                                            | Single supported chain; hook + market contracts await mainnet deployment (see `docs/security/hook-deployments.md`)                                                                                      |
| DM-105 | League coverage            | NFL + WNBA covered; NBA/MLB/NHL/Soccer show "Coming soon"                      | Owner decision. Bounds B3 data work; `coverage` field in `features/markets/sports.ts` drives nav and pages                                                                                              |
| DM-106 | Market types               | Moneyline at launch; totals W4 (P2); spreads deferred                          | Moneyline is the only genuinely binary type, so the only one fitting DM-102 without new design                                                                                                          |
| DM-107 | Settlement data source     | ESPN primary; second provider W3                                               | Covers both leagues, no key; unsupported-endpoint risk mitigated by adapter interface, second source, and manual override                                                                               |
| DM-108 | Jurisdictional posture     | Implied not marketed — no extra jurisdictional notice in the UI                | Owner decision. B10-008 keeps verification, drops disclosure; revisit with counsel before marketing push                                                                                                |
| DM-110 | Dynamic Market Hook spec   | **BLOCKED** — spec not supplied                                                | Blocks B0-003 and all six P0 tasks in B2; permission flags are mined into the hook address and are not changeable after deploy                                                                          |
| DM-111 | Agent wallet path          | **CLOSED 2026-08-17** — keep the existing Circle DCW path                      | B8-001 verified Circle Wallets fully supports Base (wallets, contract execution, signing, Gas Station); the current path already is the Circle stack, so coexistence is the plan: no migration (B8-011) |
| DM-112 | Routing split              | Market pools direct to PoolManager/PositionManager; Trading API for base pairs | Mantua-created outcome pools are not third-party indexed; base pairs already route fine                                                                                                                 |

## Risk acknowledgments

See the **Risk Acknowledgments** section in `docs/tasks/v2-roadmap.md`. Currently:

- **Risk 1:** EOA fee recipient at launch (mitigation: migrate to Safe multisig at \$5k revenue OR 6 months).
- **Risk 2:** No pre-launch legal review of fee collection (mitigation: post-launch counsel memo before any expansion of fee scope).
