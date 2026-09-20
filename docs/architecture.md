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

| Rail                  | Module                                               | Hard ceiling           | Notes                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spending cap (P1-001) | `server/src/lib/spending-cap.ts`                     | $50,000/day per wallet | Reads from `user_preferences.daily_cap_usd` (primary wallet) or `agent_wallets.daily_cap_usd`. Per-day tracking in `daily_wallet_spend`. Reset at 00:00 UTC.                         |
| Wallet age (P1-002)   | `server/src/lib/wallet-age.ts`                       | n/a                    | `recordFirstSeen` on first connection; `getWalletAge` returns `{ ageDays, tier, tierMaxCapUsd }`. Used by P1-003 cap-raise UI.                                                       |
| Slippage (P1-004)     | `server/src/lib/slippage.ts`                         | 500 bps (5%)           | `classifySlippage(bps)` returns `ok` / `warn` / `double_confirm`. Above 500 bps throws `SafetyError`.                                                                                |
| Kill-switch (P1-006)  | `server/src/middleware/kill-switch.ts`               | n/a                    | Env `MANTUA_KILL_SWITCH=1` or the Upstash runtime flag — all POST/PUT/PATCH/DELETE (+ the money crons) return 503. Reads unaffected; announced to clients via `/api/status` (D-113). |
| Rate limit (P1-007)   | `server/src/middleware/rate-limit.ts`                | 1000 req / 15 min IP   | Tighter `writeRateLimiter` and `walletRateLimiter` for chain-touching paths. Wallet keying activates after Phase 2 auth lands.                                                       |
| Audit log (P1-008)    | `server/src/lib/audit.ts` + `mantua_audit_log` table | n/a                    | Every write attempt logged with `(action, outcome, wallet, params, tx_hash, reason, ip, user_agent)`. Distinct from `portfolio_transactions` (which is success-only).                |

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

| Rail                                                 | Verdict                       | Why                                                                                                                                                                                                                                                                                                                                          | Effort |
| ---------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Agent-wallet spending caps                           | KEEP (1 fix landed, 1 open)   | Enforced at every server-signed execution point. The chat `set_cap` bypass is CLOSED (C-010, task 024): raises need the user's attested message and every value clamps through `assertValidDailyCap` — verified again in task 055 (A-047). Still open: `tokenAmountUsd` fails open to $0 on price-feed outage, disabling the cap system-wide | S      |
| User-wallet spending caps                            | REPLACE (or relabel advisory) | Checked only on `/api/quote`; calldata routes skip it; ledger increments only via a client-reported endpoint; user holds the keys                                                                                                                                                                                                            | L      |
| Uncapped money paths                                 | MISSING                       | Sports market trades, user add-liquidity/pool-create, `/api/v4/swap/calldata`, and Gateway spends (which check a counter they never increment) have no cap and mostly no audit                                                                                                                                                               | M      |
| Tier system (age-based caps)                         | REPLACE                       | `getWalletAge` has zero callers — the documented D-009 policy is entirely unimplemented; a day-one account can be set to $50k                                                                                                                                                                                                                | S      |
| x402 caps                                            | KEEP                          | Server-keyed, per-call + daily, conservative defaults                                                                                                                                                                                                                                                                                        | —      |
| `MANTUA_KILL_SWITCH`                                 | REFACTOR                      | Gates only POST/PUT/PATCH/DELETE — **all seven GET cron money-loops (rebalance, intents, strategies, resolution, sweeps) keep running with the switch on.** Flipping requires a full redeploy. Move to a per-request DB/Edge-Config read, cover GET, and check it inside `executeAgentCalldata`                                              | M      |
| `STRATEGIES_KILL_SWITCH`                             | KEEP                          | Correctly scoped, actively disarms, audited                                                                                                                                                                                                                                                                                                  | —      |
| Rate limiting                                        | REFACTOR                      | Right layering, wrong store: in-memory counters are per-lambda on Vercel and reset on cold start; needs Redis/Upstash                                                                                                                                                                                                                        | M      |
| Cron/admin auth                                      | REFACTOR                      | One shared secret unlocks settlement, sweeps, and admin ops; non-constant-time compare; `MANTUA_FEE_ADMIN_KEY` is declared/documented but read by zero code (MISSING)                                                                                                                                                                        | S      |
| `/api/rpc` proxy                                     | REFACTOR                      | Method allowlist is good, but open CORS + allowlisted `eth_sendRawTransaction` = free public tx relay                                                                                                                                                                                                                                        | S      |
| Audit log                                            | REFACTOR                      | Right schema and ~30 call sites, but inserts fail silently, `rejected_kill_switch`/`rejected_chain` outcomes are never emitted, market trades write no rows, no user-id/request-id correlation, no integrity/retention controls                                                                                                              | M      |
| Slippage enforcement                                 | REPLACE                       | `MAX_SLIPPAGE_BPS` unapplied on the v4 path (accepts 100%); min-out is display-only, absent from calldata on both user and agent paths — land it with the UniversalRouter migration                                                                                                                                                          | M      |
| Allowed-targets, hook-pair gating, peg/impact guards | KEEP                          | Server-side, default-deny, enforced in code not prompt; the attested-`force`-override pattern is the model to reuse for cap raises                                                                                                                                                                                                           | —      |

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
transaction that never calls the client's `confirm()`. Since task 055 that
path has its own server-side seam: the execution gate (D-114) — preview,
the user's explicit "confirm" in their own message, a server-minted
single-use confirmation id, a fresh simulation — with the cap + allowlist

- guard stack underneath. The client modal stays mandatory for
  _user-signed_ writes.

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
sidebar (`use-market-trade.ts` → `POST /api/markets/trade/quote` on every
amount change — nothing signable, cap checked but never recorded — then
`POST /api/markets/trade/calldata` once at commit, where the buy's spend
intent is recorded (C-019, task 050); signed by the user's wallet, with
the receipt-verified `POST /api/markets/fills` confirming the trade without
re-recording it) and the agent's `trade_market` tool plus the
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

## Launch gate (Phase 10, task 067, D-117)

The gate is a ledger (`docs/tasks/launch-gate.md`), not a checklist in
prose: every row is either closed by an artifact a reader can run or
marked as the owner's with the artifact that would close it.

- **Browser E2E** (`client/e2e/`, `npm run e2e`, `.github/workflows/e2e.yml`).
  The real client runs in Chromium under Vite with one substitution: when
  `VITE_E2E_AUTH=shim`, `vite.config.ts` aliases `@privy-io/react-auth`
  (and its `smart-wallets` entry) to `e2e/privy-shim.tsx`, a store-backed
  fake of the six exports the client uses plus an EIP-1193 provider that
  signs with a fixed address. The API is answered by Playwright routes in
  `e2e/harness.ts` from `e2e/fixtures.ts`, in the shipped wire shapes, and the chain by
  `e2e/rpc-mock.ts` behind `VITE_BASE_RPC_URL=/__e2e/rpc`. Nothing else
  is mocked, so a spec that passes has exercised the same components,
  hooks, and transports a user does. Decision D-117: a live backend in CI
  was rejected (secrets, a database, and a chain for every PR) in favour
  of scripted boundaries plus one funded run on staging (G-017).
- **Guards as tests.** Security headers (`server/src/middleware/security-headers.ts`),
  the route-guard audit (`routes/route-guards.test.ts`, a static parse of
  every mutating registration with an allowlist that names its reason),
  and the secret scan (`lib/security/secret-scan.ts`) run with the unit
  suite so the properties cannot regress silently. CSP is deferred to a
  report-only rollout because the auth iframe, Plaid Link, and the RPC
  hosts need a per-host allowlist first.
- **Legal acceptance** (`legal_acceptances`, `routes/legal.ts`,
  `client/src/features/legal/`). Versions are string constants
  (`server/src/lib/legal.ts`, `client/src/lib/legal-version.ts`); the
  ticket swaps its Confirm for a one-tap gate when the current Terms
  version has no acceptance row for the user, and a version bump re-asks
  once. The pages and the counsel drafts are kept in step by hand and
  asserted by `client/e2e/legal.spec.ts`.
- **CSP, report-only first.** `server/src/lib/security/csp.ts` is the
  per-host allowlist (each origin with its reason) and the builder for the
  `Content-Security-Policy-Report-Only` header `vercel.json` ships; a test
  pins the two together. `POST /api/csp-report` receives browser reports
  and reduces each to one log line. A clean report window on staging is
  the evidence for flipping to enforcement — the vendor host lists are
  documented, not fetched, so the browser is the oracle.
- **The drill is code.** `server/src/lib/ops/drill-core.ts` holds the
  kill-switch drill's rules (only `KILL_SWITCH_ACTIVE` counts as engaged,
  20 s limits, the log format) with tests; `scripts/kill-switch-drill.ts`
  drives a deployment through them and prints the runbook §13 log.
- **Lockfile portability.** The lockfile now carries the Linux native
  bindings beside the macOS ones so `npm ci` installs a working Vite on
  Linux runners; the Vercel build should move from `npm install
--no-package-lock` to `npm ci` (review §6).

## Market depth & research layer (Phase 11, task 068)

The market page grows downward, never sideways: every deeper data point
is a section on the same page, and the rules for what shows are pure
modules with tests.

- **One read for depth** (`server/src/lib/sports/market-depth-read.ts`,
  `GET /api/markets/depth?providerEventId=`). Keyed by event, never a
  market id (T-020). It joins the metrics module (price, 24 h move,
  volume, trades, open interest, pool liquidity), the depth curve, the
  live game state, and the chart annotations, over a `DepthDb` seam so the
  assembly is tested without Postgres (`market-depth-db.ts` binds it).
- **Depth is the cost to move the price** (`market-depth.ts`). A
  constant-product pool has no order book; the ladder quotes, for ±1, 2,
  5, 10, 20¢, the USDC and contracts that reach that price through the
  active-range liquidity L: buy `L·(√p′ − √p)` in, sell `L·(1/√p′ − 1/√p)`
  contracts in. Clamped to 1–99¢, deduplicated at the edges, labelled on
  the page as a curve, not a book.
- **Live game** (`LiveGamePanel.tsx`, `live-game-core.ts`). Score from the
  event; period, clock, possession, and the last play from the latest
  ingested play (`game_plays`), stamped with that play's time. Nothing is
  invented: a game with no plays shows the score and says why.
- **Research** (`GET /api/markets/analysis`, `ResearchSection.tsx`,
  `research-core.ts`). The same `mantua_analyze_market` the agent runs —
  a deterministic read over the canonical database, no model call —
  cached a minute per side, rendered with the agent-estimate tag (T-021)
  and the prediction note (T-022); the market price is quoted beside it,
  never replaced by it.
- **Layered disclosure** (`disclosure-core.ts`, `MarketDepthSections.tsx`).
  Four sections — Depth & liquidity, Fees & execution, Research, Past
  markets — start closed; each toggles independently; "Open all" opens
  the available ones; an unavailable section says what it waits for.
- **Annotations** (`market-depth-annotations.ts`, `chart-annotations.ts`).
  Kickoff, the first ingested play of each period, the freeze, the
  resolution, and up to six injury reports for the two teams; placed on
  the chart's time axis in two lanes so labels never overlap. Halftime is
  the start of period 3 where a play was ingested; no timestamp is
  estimated.
- **History** (`GET /api/markets/history`, `history/`). Resolved moneyline
  markets with the final score, the latest resolution's outcome, the
  home-side settlement price ($1, $0, or 50¢ voided), and a sampled price
  path; a page filterable by league, reached from the market page's Past
  markets section and from Discover.
- **Proof** (`client/e2e/market.spec.ts`, `market-depth.e2e.test.ts`). The
  browser spec asserts each data point with the page heading still
  visible; the node test composes the shared wire fixtures through every
  pure module.

## Voice input (Phase 12, task 069)

The microphone is an input method, not a command path. It produces text;
the text goes into the command bar's `onSubmit` — the same function the
Send button calls — and everything after that is the pipeline typed
commands already used. There is no voice parser, no voice intent type and
no voice execution route, which is what makes V-004, V-005 and V-008 hold
by construction rather than by a check someone has to remember.

- **The key never reaches the browser** (`server/src/lib/voice/`,
  `routes/voice-token.ts`). `ELEVENLABS_API_KEY` is spent server-side on a
  **single-use token** (`POST /v1/single-use-token/realtime_scribe`), which
  expires in fifteen minutes and is consumed on first use. `POST
/api/voice/token` is authenticated, rate-limited per user, and answers
  the token, its expiry and the model id — a test asserts the body has no
  fourth field. No key means 503, and the microphone is simply not offered.
- **The browser holds the socket, not our server.** The page opens
  `wss://api.elevenlabs.io/v1/speech-to-text/realtime` itself with that
  token. Relaying audio through our server would double the latency the
  model's 150 ms design exists to avoid, and would buy nothing: the token
  already keeps the key server-side. The origin is listed in the CSP
  `connect-src`, and `Permissions-Policy` grants `microphone=(self)` on the
  SPA document only — the API's own responses keep it closed.
- **Push-to-talk, and only that.** No wake word, no open microphone. That
  is most of the answer to accidental activation (V-007): a press shorter
  than 350 ms is treated as a slip and passes in silence, and a real press
  that yielded no words gets "I didn't catch that" rather than submitting
  nothing-shaped text.
- **Two kinds of correction** (V-006). The model revising its own partial
  transcript is handled by replacing the provisional text in place
  (`transcript-core.ts`). The speaker correcting themselves is handled by
  `correction-core.ts`, deliberately narrowly: a restart marker drops what
  came before, an amount marker swaps the last figure, and **anything else
  is left exactly as spoken**. Guessing more broadly is how a voice
  interface puts words in a user's mouth.
- **Speech is never consent** (V-009). This is the one place voice is
  deliberately weaker than typing. `buildTurnContext` refuses to mint a
  confirmation from a turn marked `source: "voice"`, and a spoken turn is
  never eligible for autonomous execution either, so the same words that
  confirm when typed confirm nothing when spoken. The client half
  (`confirm-guard.ts`) catches a bare "yes" or "confirm" before it is sent
  and says why — not because the server needs the help, but because a user
  who watches the word land in the chat would otherwise believe it counted.
  Confirmation stays a press.
- **Failure always lands on the keyboard** (V-010). Permission refused, no
  device, token rejected, quota gone, socket dropped, silence — each maps
  to one sentence in `voice-status-core.ts`, and the text input never stops
  working. The three failures a second press cannot fix retire the button
  for the visit; the rest leave it usable.
- **No new dependency, and no stored audio.** The server mints with one
  `fetch`; the browser uses its own `WebSocket` and an `AudioWorklet`
  served from `client/public/voice/`. Audio is streamed to the
  transcription service and discarded — nothing is written to disk or to
  the database, and only the resulting text enters the command interface.
- **Proof.** `voice-audit.test.ts` walks the feature and fails if any
  module imports a parse, confirm, sign or execute path, or names an
  endpoint other than the token mint. `client/e2e/voice.spec.ts` drives a
  scripted microphone through both journeys of V-011 and asserts that
  saying "confirm" does not fill an order while pressing Confirm does.

## Agent extended — ledger, voice, support (Phase 13, task 070, D-107)

Three capabilities on one rule: **the ledger is derived, not declared.** A
performance number that could be typed is a number that could be edited,
so everything the public sees is computed on read from records nobody
edits through the app.

- **The canonical ledger** (`server/src/lib/agent/ledger.ts`,
  `ledger-metrics.ts`, `ledger-read.ts`). Entries are the wallet's
  chain-verified fills (`market_fills`, unique on tx hash) joined to market
  resolutions and the audit trail; simulations come from the activity
  timeline in their own block and never enter P&L. Realised P&L reuses the
  Phase 8 per-market ledger; unrealised P&L reuses the marked positions;
  ROI is realised over capital deployed; drawdown is peak-to-trough on the
  cumulative realised series ordered by resolution, expressed against
  capital deployed; exposure is open cost and its mark; the risk block is
  largest stake share, largest loss, profit factor, average stake. A
  SHA-256 digest over every fill hash and simulation id lets two readers
  prove they saw the same history.
- **Mode on every entry (AE-013).** `auditChatToolCall` now records the
  agent mode in the audit params, and `execution-mode.ts` maps an audit
  row to `user_confirmed` (a confirmation id was presented), `autonomous`
  (autonomous mode without one, or a hedge-engine fill) or `unattributed`
  (no row, or nothing to go on — never assumed confirmed). A market whose
  fills span two modes is counted under neither.
- **Immutability at the database (AE-014).** Migration 0022 adds a
  trigger that refuses UPDATE and DELETE on `market_fills`; no server code
  deleted anything before, and now a direct write cannot either. The
  public route accepts no parameter that filters by outcome, and the
  client's row mapping is tested to keep every loss.
- **The public page** (`routes/agents-public.ts`, `/agents/<handle>`). A
  user claims a lower-case handle (`agent_social_profiles`, one per user);
  the page needs no login, is cached for a minute across instances, and
  answers the same 404 for an unknown and a private handle so the
  namespace does not leak. The app restores the route from the URL on
  load and keeps the address bar honest while it is open.
- **D-107 — one platform account, per-agent voice.** X is the platform.
  The deployment holds one X app's consumer key/secret and one user
  token/secret in server env; OAuth 1.0a signing is `node:crypto` over the
  canonical string, pinned to X's published reference vector
  (`social/oauth1.ts`). An agent "connects" by claiming its handle and
  enabling posting; posts go out through that account with the agent
  named in the text. With any credential missing every post is a recorded
  dry run. Per-agent OAuth is the recorded next step. Nothing from the
  login shared in the task prompt is used or stored: a password cannot
  drive the API, and a password pasted into a tracker is a disclosed one.
- **Posts are templates over data, linted, then gated.**
  `candidates.ts` ranks open markets whose game is live or within the day
  by the size of the hour's move; `explain-move.ts` attributes a notable
  move to a thin pool, scoring, one-sided flow, or a repricing the score
  does not explain; `price-signal.ts` turns that repricing into a forecast
  (news implied, momentum, score-confirmed) graded by move size and pool
  depth; `templates.ts` renders the three posts with the agent's name,
  its page and the disclaimer, trimming the body so the footer is never
  cut. `compliance.ts` refuses guarantees, missing disclaimers, over-length
  text, directives to bet, and any figure in a performance sentence that
  the ledger did not produce. `posting-policy.ts` holds the user's
  approved templates, hourly/daily caps, spacing, quiet hours and the
  approval rule; `post-run.ts` runs the gate sequence per tick with every
  dependency injected, and records every attempt whatever happened to it.
  The tick is `GET /api/cron/social-posts` every fifteen minutes from
  GitHub Actions, like live-sync.
- **Support is read-only and channel-agnostic** (`server/src/lib/support/`).
  One generator answers from a code knowledge base (tested against the
  constants it describes), the signed-in caller's own activity, transfers,
  positions and agent standing (read once per turn, never by address),
  the platform status, deterministic troubleshooting flows, and an
  escalation that writes a bounded ticket and pages a webhook with the
  ticket but never the transcript. `POST /api/support/chat` streams it;
  `POST /api/support/message` returns it whole for other channels. A test
  asserts none of its tools is a money-moving tool.
- **One chat transport on the client.** `client/src/lib/chat-stream.ts`
  is the SSE POST helper the wallet agent, the analyst and support share.
  The refactor surfaced a real defect: the agent stream client never sent
  the `source` field, so the V-009 spoken-confirmation interlock could not
  fire from the app. It is sent now.

## Mobile experience (Phase 15, task 071, D-118)

Everything a phone needs is a couple of taps away, and the same code the
desktop runs. The breakpoints are constants (`client/src/lib/mobile.ts`):
below `md` (768 px) the header nav is behind the hamburger and layouts are
single-column (B-014); below `lg` (1024 px) the trade ticket is a bottom
sheet. `TOUCH_TARGET_PX` is 44 and the mobile suite measures it.

- **The trade sheet** (`features/markets/ticket/TradeSheet.tsx`,
  `ui/sheet.tsx` `side="bottom"`). A price tap on the league page opens the
  sheet with that side set; a Discover tap, a Close, or a notification
  deep-links into it. It renders the same `TradeTicket` as the sidebar —
  the tap machine (`trade-ticket-core.ts`) is untouched, so a trade is
  still three taps and an exit two. Confirm sits in the thumb zone.
- **The live glance** (`features/markets/live/`). One card per game in
  progress on the league page: score, both prices, and for a held side the
  contracts, the price now, the value, the P&L and a Sell / Lock in that
  opens the sheet on Sell with the full balance. Pure core, node-tested.
- **Push notifications** (`server/src/lib/push/`, `routes/push.ts`,
  `client/src/features/notifications/`, `client/public/sw.js`). Web Push
  on `node:crypto` alone — RFC 8291 `aes128gcm` verified byte-for-byte
  against the RFC's Appendix A vector, RFC 8292 VAPID. Five topics:
  trades, positions, games, agent, settlement. Trade confirmations, agent
  actions and settlement come off `recordActivity` (the D-115 spine, so
  every money path is covered by one hook); game events and 10¢ position
  steps come off the live-sync tick. Delivery is idempotent per
  (user, tag) through `push_deliveries`' unique index, claimed before the
  send. A push carries a title, a sentence and an in-app path — it can open
  a page and nothing else. Keys are three env vars; absent, the feature is
  dark and the client never asks for permission. Ops:
  `docs/ops/push-notifications.md`.
- **The installed app** (D-118). `manifest.webmanifest`, icons, a service
  worker that caches hashed assets and the shell and never `/api/`, an
  install offer earned by a trade or a visit to the portfolio and
  remembered when dismissed (`features/pwa/`), and launch routes
  (`lib/launch-route.ts`: `?open=market|profile|agent|discover|home`) that
  shortcuts and notification taps land on.
- **Voice on a phone** (`features/voice/press-events.ts`, `MicButton.tsx`).
  Pointer capture keeps the hold while a finger drifts; a cancelled gesture,
  a hidden page or a lost focus releases; the long-press menu is
  suppressed; iOS's suspended audio context is resumed; the target is 44 px.
- **The budget** (`lib/mobile-budgets.ts`, `e2e/mobile/perf.spec.ts`,
  `bundle.spec.ts`). A mid-tier profile (Chrome's Slow 4G, 4× CPU) and the
  numbers with their reasons, enforced against the production build under
  `vite preview`. `app-lazy.ts` defers the swap, liquidity, analyze, agent,
  history, legal and docs surfaces; `vite.config.ts` splits the Circle
  bridge kit, x402, Solana, the charting library and Plaid into leaf chunks
  only those surfaces pull. The wallet stack the auth provider needs on
  every page is what remains on the critical path (benchmark §Next cut).
- **The phone profile** (`features/portfolio/MobileProfile.tsx`). Positions,
  Portfolio, Agent, Account as four tabs, positions first; the same sections
  the desktop page shows, with the wallet card shared
  (`ProfileWalletSection.tsx`).
- **Proof.** `client/playwright.mobile.config.ts` runs `e2e/mobile/` at
  360 × 740 and 430 × 932 (Chromium, touch, mobile UA) on every PR beside
  the desktop suite; `docs/design/mobile-audit.md` cites a spec for every
  tap count and `docs/design/mobile-benchmark.md` records the numbers.

## Combos — a combo is a market (Phase 16, task 072, D-119)

A combo ticket (_Cowboys + Chiefs + Raiders_) is one buy of a conjunction
market: a full-collateral market, created through the same factory as a
game market, whose YES pays $1 if every leg's YES pays. Nothing new on
chain; the composition, the settlement rule, the ticket and the agent are
new.

**Identity and creation.** `computeComboMarketId(sortedLegIds)`
(`server/src/lib/market-id.ts`, spec `docs/specs/market-id.md`) — order
independent, distinct from every moneyline id, chain-mixed off Base. The
market's `startsAt` is the latest leg kickoff (the 12 h backstop outlives
every leg), its label the legs joined, its opening price Π leg prices, its
season flag on if any leg is a playoff game. `POST /api/combos/prepare`
creates it when absent through `createMarketsOnChain` with the combo seed
(`COMBO_SEED_USDC`), under `COMBO_MAX_OPEN_MARKETS` (409 `COMBO_CAPACITY`).

**Rules and limits (CB-001, CB-010).** `combo-rules.ts` refuses fewer than
two legs, more than the cap, a duplicate market, two legs from one game,
one team twice, a leg whose market is not OPEN or whose game is over, an
unpriced leg, a league outside the policy — each naming the leg.
`combo-policy.ts` is the user's `combo` block on the agent policy
(enabled, max legs, max stake, max open exposure, max payout, take-profit
line, auto-manage) plus the platform env limits, enforced by one
`comboPolicyGate` before any quote and again at calldata.

**Pricing (CB-003, CB-004).** `combo-pricing.ts`: fair probability = Π leg
prices (independence, disclosed); the pool's own quote when the market
exists, an opening estimate with the hook's fee formula (`planned`) before;
combined odds, shares, payout at par, the premium of pool over fair. The
quote (`combo-quote.ts`, `POST /api/combos/quote`) also carries each leg's
own hook fee for an equal split of the stake, so the ticket shows what the
same legs cost as separate tickets. The client renders
`feeLines(feeSummary(stake, hookFee))` — the single-trade standard, the
0.70 % ceiling enforced as a render refusal.

**One transaction (CB-005).** `POST /api/combos/calldata` is one swap on
the combo pool through `buildMarketSwap` (the swap half of
`buildMarketTrade`, extracted so both share it), cap-checked and recorded
once for the whole stake (`guardSpend`), refused for a dead combo (a leg
lost), a closed market, or a dark in-play feed (P-012). `POST
/api/combos/fills` verifies the receipt (success, our router as target,
sender from the chain) and records the ticket; the legs the client reports
must recompute to the market id — the id is the commitment over exactly
those legs. The pending register re-reports a combo fill after a reload.

**Settlement (CB-007).** `combo-settlement.ts`: `legResultFrom` reads a
leg from its market state and the resolutions log (never guesses a
winner); `comboOutcome`: any lost → lost, every non-void won → won, every
leg void → void, a void leg drops out. `planComboResolution` freezes then
resolves/voids through the resolver once the combo's `startsAt` has
passed (the contract's rule for the resolver). The resolution cron runs
`runComboSettlement` after the leg pass: stamps leg results, marks dead
tickets, submits through `authorizeComboResolution` (evidence = the legs'
results), settles tickets with `combo_settle` on the timeline.

**Portfolio (CB-008).** `GET /api/combos` lists the caller's tickets
(`combo-tickets.ts`) with live leg results, the combo pool mark, value,
P&L and payout; the profile's Combos section (desktop and the phone's
Positions tab) shows every ticket whatever its outcome; the holdings
aggregate has a Combos part; `combo_open` / `combo_close` /
`combo_settle` are timeline kinds with pushes.

**Agent (CB-006, CB-009).** `combo-agent.ts` proposes legs by edge (the
provider's own probability vs the recorded pool price) sized by the risk
level under every limit; `mantua_build_combo` saves the quote as a `combo`
preview; `mantua_execute_combo` passes the execution gate with a fresh
re-quote and `materialComboDrift` (the single-trade thresholds), then
ensures the market, cap-checks once, swaps from the Circle agent wallet
and records the ticket with mode `user_confirmed` or `autonomous`. The
monitor (`GET /api/cron/combos`, every 15 min from
`.github/workflows/combos.yml`) plans per ticket (`combo-monitor.ts`): mark
dead, take profit at the policy line, or hedge the last pending leg in
that leg's own market sized to recover the stake — executed for
agent-built tickets under `autoManage` in autonomous mode, recommended on
the timeline otherwise, never repeated for one ticket and action in a day.
A conjunction token cannot cash out one leg; nothing here pretends it can.

## Institutional custody — an institution is a segregated wallet set (Phase 18, task 073, D-120)

The institutional tier adds nothing to how money moves; it adds rules at
the three points every money path already passes. Ledger:
`docs/tasks/073-institutional-custody.md`.

**Who holds which key (unchanged from C-009).** Members sign in with Privy
like anyone else; their personal wallets are theirs and outside this
tier. The institution's trading balances live in Circle
Developer-Controlled Wallets — SCA accounts whose custody root is the
operator's entity secret, held only in the secrets manager. The
institution's _principal_ stays with its qualified custodian (Anchorage,
BitGo, Coinbase Prime, Fireblocks, Copper, …), recorded on the account
(`institutions.custodian`) and never integrated: Mantua holds no
custodian credential, and the custodian's deposit addresses are the only
places funds may leave to.

**Segregation in Circle terms.** Circle groups wallets in _wallet sets_;
the retail agent wallets share `CIRCLE_WALLET_SET_ID`. An institution
gets a wallet set of its own, created through the same SDK
(`provisionInstitutionWalletSet` → `createWalletSet`, pinned on
`institutions.circle_wallet_set_id`), and every member's agent wallet is
created in it (`walletSetForUser` inside `getOrCreateAgentWallet`;
`agent_wallets.wallet_set_id` records the set). A member whose wallet
predates their membership moves it with `segregateAgentWallet` — only
when the wallet holds no USDC; funds are never moved by this path. The
effect is that Circle's per-set controls (the Gas Station policy,
transaction screening configured in the Console) and the balances Circle
reports scope to the institution alone, and a wallet outside the set
cannot spend (`wallet_unsegregated`).

**The three choke points.**

1. `checkSpendingCap` (`server/src/lib/spending-cap.ts`) — every trade,
   combo, hedge, send and gateway spend. `assertCustodySpend`
   (`lib/custody/custody-gate.ts`) looks the wallet up; for an
   institutional wallet the pure `spendGate` requires an active
   institution, an active member whose role may trade, the wallet in the
   institution's set, the amount within the institution's per-trade cap,
   and the institution's aggregate spend today (summed over every member
   wallet in `daily_wallet_spend`) within its daily cap. Each refusal is a
   `SafetyError("custody_refused")` naming the rule. Retail wallets are
   untouched.
2. `sendFromAgentWallet` (`lib/agent-send.ts`) — the only agent send.
   `assertCustodySend` admits a send from an institutional wallet only as
   the execution of a custody withdrawal in its `executing` claim, for
   that wallet, to its verified destination, of exactly that token and
   amount (`custody_withdrawal_required` otherwise). The agent's chat send
   and every other caller are refused.
3. `getOrCreateAgentWallet` (`lib/agent-wallet.ts`) — the wallet set is
   the institution's; an institution without a provisioned set refuses to
   create wallets rather than fall back to the retail set.

**Dual control.** `custody-roles.ts` holds the matrix — owner (all),
admin (people, destinations, reports; not the limits), trader (trade,
request withdrawals), approver (approve withdrawals, verify
destinations), viewer (reports) — and the two rules: a destination is
verified by someone other than its adder, a withdrawal is approved by
someone other than its requester. A request below
`approval_threshold_usd` is approved by the rule and executed at once; at
or above it a second member decides; `0` means every one. Execution
claims the row (`approved → executing`, one conditional update) so a
double click or a webhook race can never send twice; a receipt timeout
leaves it `executing` with the error and is never retried by this path.
Requests expire after 24 h.

**Reporting.** `custody-reports.ts` builds the period statement over
every member wallet — fills, confirmed portfolio transactions, Circle
executions that did not confirm, custody withdrawals, the daily spend
ledger — as JSON or CSV (`GET /api/institution/reports/statement`), and
the audit trail (`/audit`). `custody-reconcile-run.ts` reads, per wallet,
the USDC balance Circle reports for the wallet id and the chain's
`balanceOf` for its address and compares them (`/reconciliation`):
`matched`, `drift`, or `unavailable` when either side could not be read —
never `matched` by default.

**Surfaces.** Operator: `/api/ops/institutions` (create with the first
owner, provision, patch status and limits) behind `requireOpsAuth`
(`MANTUA_OPS_KEY`, 503 when unset). Members: `/api/institution` (the
account, the caller's role and permissions, wallet segregation state,
destinations, members for admins), `/members`, `/destinations`,
`/withdrawals`, `/reports/*`, `/wallet/segregate`. Client: the
Institution section on the profile and the phone's Account tab, shown to
members only.

**What the tier does not do.** It does not integrate a custodian's API,
hold custodian credentials, move funds between the custodian and Circle,
or constrain a member's personal Privy wallet. Segregation and dual
control apply to the institution's Circle wallets; the principal at the
custodian is governed by the custodian.

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

### Live-sports reliability — transport, status, trade state (D-113, task 051)

1. **Why SSE and not a WebSocket.** The API is one Express function on
   Vercel with no long-lived process to own a socket registry and no
   pub/sub bus. SSE rides plain HTTP through the same rewrite, reconnects
   for free (`retry:` + `Last-Event-ID`), and the client already parses
   `text/event-stream` for the agent chat. The WebSocket grammar above
   (subscribe by id, event_type frames, snapshot-then-deltas, heartbeat) is
   honored over SSE; a socket server is the upgrade path if the API ever
   leaves the single function.
2. **Why the status is computed from the enforcement points' inputs.** A
   banner that used its own thresholds would eventually say "live" while
   the trade gate said "halted". `assessPlatformStatus` reads
   `IN_PLAY_FEED_MAX_AGE_MS` and `CANONICAL_FRESH_MS` — the trade gate's and
   the slate route's constants — and the kill switch through the gate's own
   reader.
3. **Why a pending register on the client, not a pending table on the
   server.** The user signs and broadcasts; the server has no hash until
   the client tells it. The register persists that hash per wallet and the
   server verifies every claim against the chain (`/api/markets/trade/
status`, `/api/markets/fills`). A server-side indexer is the upgrade
   path for trades the client never reports at all.
4. **Why a 5-minute GitHub schedule.** Vercel Hobby crons are daily; the
   P-012 halt needs `last_polled_at` at game cadence. The read-only
   `/api/cron/live-sync` is cheap enough for 5 minutes and exempt from the
   kill switch, so a paused platform still shows live scores.

### Agent policies — the user's limits on the agent (D-109, task 057)

1. **Why one row with defaults, not required setup.** A user who never
   opens the settings still gets a bounded agent ($25 per trade, $100
   exposure per market, $100 hedge budget per day) — the defaults are the
   conservative policy, and a missing row reads as those defaults.
2. **Why the agent cannot write it.** A-012: the agent must not change its
   own caps. The C-010 attested raise is one bounded exception for the
   daily cap; the policy has no chat path at all — `mantua_get_policy`
   reads, `PATCH /api/agent/policy` (the user, audited) writes.
3. **Where each limit bites.** Per-trade stake, leagues, status and
   per-market exposure block in the simulation (so the model sees the
   reason before asking the user to confirm); hedge size clamps and the
   market-type / confidence / cooldown / budget holds run in the strategy
   executor before the daily-cap ledger, independent of the model (A-041).
   Holds a later tick can pass (cooldown, budget) release the claim; holds
   that need a person (paused, market type, confidence) leave the strategy
   `triggered` and recorded.

### Agent tool architecture — the five layers (A-019, task 056)

The agent is a proposer inside a stack where no layer trusts the one
above it:

| Layer                   | What it is                                                                                                                                                                                                                                                                                                                      | Where                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1. Skill                | Prompt guidance: how to analyze, which tool first, what to cite. Advice, never authority.                                                                                                                                                                                                                                       | `SYSTEM_PROMPT` in `server/src/lib/agent-chat.ts`                                                          |
| 2. Tools                | Typed reads (`mantua_search_markets`, `mantua_get_market`, `mantua_get_position`, `mantua_get_portfolio`, the sports detail tools) and typed writes (`mantua_simulate_trade` → `mantua_execute_trade` / `mantua_sell_position`, swap, send, …). Inputs are zod-validated; outputs say `unavailable` / `null` rather than guess. | `TOOLS` + `executeTool`; `lib/sports/agent-sports-tools.ts`; `lib/agent/read-tools.ts`                     |
| 3. Wallet authorization | The server-custodied Circle wallet signs; the daily cap, the attested cap raise (C-010), the user's `agent_policies` row and the kill switch are checked in code before any signature.                                                                                                                                          | `lib/spending-cap.ts`, `lib/agent-wallet.ts`, `middleware/kill-switch.ts`, `lib/agent/trade-simulation.ts` |
| 4. Contract enforcement | Only allowlisted targets (`registerDynamicTargets`), the same market contracts and hook path the user's ticket uses, market state and fee decided on-chain.                                                                                                                                                                     | `lib/sports/market-agent-trade.ts`, `lib/sports/market-trade-build.ts`, the hook                           |
| 5. User permission      | The D-114 gate: preview → the user's own explicit "confirm" → a server-minted single-use id → matching execution with a fresh simulation.                                                                                                                                                                                       | `lib/agent/execution-gate.ts`                                                                              |

Reads (layers 1–2) run freely and use no user data beyond the agent's
own wallet address. Writes must pass 3, 4 and 5 in that order; the model
can neither see nor change `AGENT_MODE`.

### Portfolio valuation (D-116, task 066)

1. **Why Pyth-first with a fallback, and why $0 stays possible.** The
   read path must degrade, not blank; an outage on both feeds values the
   token at 0 — visibly (`pricing.fallback_zero`, the `pricing_zero`
   alert) — while the write path (caps) keeps the strict helpers that
   refuse to trade on a missing price.
2. **Why market marks are the pool.** A prediction position's price is
   the pool's implied probability, read on-chain; no external feed exists
   for it and none is wanted.

### Unified Activity (D-115, task 062)

1. **Why a dedicated table.** The ledgers each answer one question
   (fills for price ticks, positions for marks, fiat transfers for rails,
   the audit log for compliance). "What happened to my money, in order"
   needs one row shape with a status and an actor; `activity` is that,
   written beside the ledgers, never instead.
2. **Why best-effort.** A timeline gap is recoverable; a trade record
   that fails because the timeline insert failed is not. `recordActivity`
   logs and returns null; nothing upstream awaits its success.
3. **Why pending is keyed by the Circle tx id.** A sponsored send has no
   hash until it is mined; the entry exists from acceptance so the user
   sees "pending", and the hash arrives with the terminal transition.
4. **Where it lives.** `server/src/lib/activity.ts`, `routes/activity.ts`,
   `db/schema/activity.ts`, migration `0020_activity_spine`.

### Agent loop seam, attribution, gate monitoring (A-017/A-039/A-040, task 061)

1. **Why the loop has a dependency bag.** `runAgentChat` is the one place
   the model, the gate and the tools meet; `AgentLoopDeps` (defaults =
   production) lets the loop test run the real loop with a scripted model
   and the real `executeTool`, proving the refusal path, the feedback to
   the model, and the confirmation plumbing without a wallet or a chain.
2. **Why attribution comes from the audit log.** Every money path already
   writes an audit row with the tx hash (`agent_market_trade`,
   `strategy_execute`, the user's fills route); joining fills to those
   rows attributes P&L without a schema change.
3. **Why the refusal rate is a warning, not a page.** A refused execution
   moved no money; a high rate is a prompt or drift regression to look at,
   with the codes in the detail.

### Agent chat cards, brief, performance, funnel (A-002/A-014/A-016/A-043/A-044, task 060)

1. **Why the Confirm button sends "confirm".** One consent channel: the
   server reads consent only from the user's own message (D-114). A
   button that posted to a confirm endpoint would be a second channel with
   its own audit shape; the button instead submits the literal message
   through the same path as typing.
2. **Why the brief is a tool.** `mantua_daily_brief` is the agent's own
   structured read (wallet, positions, track record, policy, markets worth
   a look); as a tool result it streams like every other step and the UI
   renders it as a card, while the model narrates.
3. **Why performance is server-side and pure.** Realized P&L needs fills
   and resolutions; `computePerformance` scores a market only after its
   resolution (payout at par for the winning side, refund on void) so the
   number the agent cites equals the one the portfolio shows.
4. **Why counters, not a vendor.** The user-testing funnel (turn → analyze
   → simulate/preview → confirm minted → execute / refused) rides the
   per-instance counters already on `/api/ops/metrics`; a product
   analytics vendor is an owner decision.

### Agent skill: sports_intelligence (A-004/A-022, task 059)

1. **Why a transparent additive estimator.** The same facts must give the
   same number, and the user must be able to see why. `analyzeSide`
   applies bounded, itemized adjustments (venue, season record, recent
   form, injuries, head-to-head, live score) on a 50/50 baseline and
   returns every component with its effect, the market's implied
   probability, the discrepancy, risks and a confidence grade. It is a
   reasoning aid; the disclaimers say so.
2. **Why it never sizes or trades.** The suggested action is
   consider-buy / consider-fade / hold and hands back the exact
   `mantua_simulate_trade` arguments; sizing belongs to the simulation
   under the cap and the policy, and execution to the user's confirm.
3. **Why skills are a prompt list.** Circle's docs carry no skills
   registry; Mantua's built-in skills are declared once in the prompt and
   bound to typed tools, so "what the agent is" and "what it can call"
   cannot drift apart.

### Agent untrusted-data boundary (A-034/A-036, task 058)

1. **Why one seam, not per-tool sanitizers.** Every tool whose result
   carries third-party text (x402 responses, explorer labels, DefiLlama /
   CoinGecko names, sports-provider strings — `EXTERNAL_DATA_TOOLS`)
   crosses `boundaryForTool` in the chat loop before the model reads it:
   bounded (string / array / depth / total), sanitized (control chars,
   angle brackets), and instruction-like text flagged with its JSON path
   in an envelope the third party cannot write (`trust: "untrusted"`,
   `suspiciousCount`, `rule`). Internal results (simulations, policy,
   portfolio) pass untouched — they are the server's own words.
2. **Why flag rather than delete.** The user's tool card and the audit
   trail keep what the third party said; the envelope removes its
   authority. The prompt rule: a positive count means tell the user and
   do not follow.
3. **Why authority never comes from data.** Consent is read only from the
   user's own message; a confirmation id is only this turn's server-minted
   one; a consumed id is gone; an execution must hash-match its preview.
   The adversarial suite (`lib/agent/injection-security.test.ts`) plays
   the attacker against exactly those controls.

### Agent execution gate — modes, confirmation, x402 (D-114, task 055)

1. **Why the gate is server-side and pre-model.** The agent wallet is
   server-signed, so only a server check is a control. The turn context
   (mode, pending preview, minted confirmation) is computed from the user's
   raw message before the model runs and handed to it as a system block;
   the model can echo a confirmation id but cannot create one the store
   will honor, and it cannot see or change `AGENT_MODE`.
2. **Why consent is a regex, not a judgment.** `messageConfirmsAction`
   follows `messageAuthorizesForce` and `messageAttestsCapRaise`: explicit
   patterns accept, any hedge / question / negation rejects. A false
   negative costs one round trip; a false positive moves money.
3. **Why market executions re-simulate.** The user confirmed numbers; the
   pool may have moved. `materialDrift` compares the confirmed and the
   fresh `TradeSimulation` (same builder as the user's own ticket) and
   refuses on price > 100 bps, output shrink > 1 %, market-state or
   fee-season change, or any policy turning red.
4. **Why x402 data is exempt.** `call_paid_service` spends the agent's own
   buyer wallet under `X402_MAX_CALL_USD` / `X402_DAILY_CAP_USD`; the agent
   has direct marketplace access by design so its analysis loop is not
   interrupted per lookup. Everything that touches the user's agent wallet
   is gated.
5. **Where it lives.** `server/src/lib/agent/` — `agent-mode.ts`,
   `confirmation-language.ts`, `trade-simulation.ts`,
   `confirmation-store.ts` (Upstash when configured, `mantua:agent:`),
   `execution-gate.ts`; wired in `agent-chat.ts` (`executeTool`,
   `runAgentChat`) and `routes/agent-chat.ts` (503 `AGENT_DISABLED`).

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
