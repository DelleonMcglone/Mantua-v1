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

| Convention                                                                                                                                                                                   | Source                                         | Verdict                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every YES/NO pair is backed by exactly $1 of locked collateral; split ($1 → 1 YES + 1 NO), merge (pair → $1, "exit without trading"), redeem ($1 per winning share, pull-based, no deadline) | concepts/positions-tokens.md                   | **Adapt — highest-leverage item.** Two independent v4 pools can price YES+NO ≠ $1 with no correcting force; the split/merge arb path is the enforcement mechanism. Implement split/merge/redeem on Mantua's ERC-20 pairs even though the venue differs. Keep split/merge out of mainstream UI (Polymarket barely surfaces it). |
| Price IS probability, $0.00–$1.00; YES + NO sum to $1 (enforced at match time by mint/merge, not decree)                                                                                     | concepts/prices-orderbook.md                   | **Adopt** for display; report spot probability normalized pYES/(pYES+pNO), raw pool prices separately.                                                                                                                                                                                                                         |
| Invalid/void outcome: "market resolves 50/50 — each token redeems for $0.50"                                                                                                                 | concepts/resolution.md                         | **Adopt** — this is exactly what Mantua's INVALID state should pay (postponed/abandoned games); preserves the $1-per-pair invariant.                                                                                                                                                                                           |
| One canonical display price with a documented fallback (midpoint; last trade when spread > $0.10; "0.5" placeholder for never-traded)                                                        | concepts/prices-orderbook.md                   | **Adapt** — AMM spot is the midpoint analogue; document the stale/empty-pool fallback; use the 0.5 placeholder for capture-less markets.                                                                                                                                                                                       |
| Taker fee = C × rate × p × (1 − p), sports rate 0.05; symmetric, maximal at 50¢, vanishing at extremes                                                                                       | trading/fees.md                                | **Adapt** — a flat AMM fee is proportionally brutal on longshots (1¢ on a 3¢ share ≈ 33%). The p(1−p) curve is implementable as a v4 dynamic-fee hook; 0.05 is a documented sports calibration point.                                                                                                                          |
| Sports in-play defense: outstanding orders cleared at game start (`clearBookOnStart`); live orders wait a configured `secondsDelay` before matching                                          | concepts/markets-events.md, order-lifecycle.md | **Adapt** — validates Mantua's freeze-at-kickoff (the AMM analog of the delay window; you can't "delay" a swap). If live in-game trading ever ships, a disclosed commit delay is the trust mechanic.                                                                                                                           |
| Resolution pipeline (UMA optimistic oracle: $750 bond, 2-hour challenge, escalating disputes)                                                                                                | concepts/resolution.md                         | **N/A on mechanism** (Mantua resolves server-signed), **adapt three conventions**: a sanity window between RESOLVED and SETTLED before redemptions open; a signer-enforced can't-resolve-before-gameStartTime check; user-visible pipeline states (Trading → Result in → Resolved → Claimable).                                |
| Negative-risk groups for mutually exclusive outcomes ("exactly one resolves Yes"); NO-in-one ↔ YES-in-all-others conversion                                                                  | concepts/negative-risk.md                      | **N/A for binary v1.** If 3-way soccer ships: three linked binary markets with the exactly-one-YES invariant enforced server-side; the conversion mechanic needs shared collateral and doesn't map to per-outcome AMM pools.                                                                                                   |
| Market lifecycle is flags (`active/closed/archived/acceptingOrders/restricted/live/ended`), and markets exist before trading opens and stay queryable after close                            | market-data/market-details.md                  | **Adapt** — Mantua's OPEN/FROZEN/RESOLVED/SETTLED/INVALID enum is cleaner; borrow: `gameStartTime` distinct from endDate, a per-market `restricted` geo flag, and decoupling API existence from pool deployment.                                                                                                               |

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

4. **Risk bounds are immutable.** `BASE_FEE`, `MAX_FEE`, `ABS_MAX_TRADE`,
   `MIN_TRADE_CAP` are `constant` in a library, not storage, so there is no
   setter to protect and no governance path to compromise. An attacker holding
   every key still cannot charge 50% or lift the size cap. Storage plus an
   owner check would have made those the same class of risk as the keys.

5. **Kickoff protection is timestamp-driven.** The freeze reads the timestamp
   stored at registration and compares it to `block.timestamp`. A keeper-driven
   freeze would fail exactly when it matters most — a crashed or lagging keeper
   at kickoff would leave a started game tradeable against people who can see
   the field. Registration is once-only and there is no kickoff setter, so
   nobody can push the deadline out either.

6. **Stale keeper state fails closed, not shut.** Past `STALE_AFTER` the fee
   clamps to `MAX_FEE` and the cap to `MIN_TRADE_CAP`, and the model-deviation
   premium drops out. Reverting instead would let keeper downtime brick a live
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

**Deviations from spec §30:** eight files rather than seven — `MarketFlow.sol`
was extracted to keep every file inside the 150-line limit. The Nezlobin
directional _shape_ is reused from the dynamic-fee hook, but not its code: that
library keys off an oracle-deviation zone, and a prediction market has no
external reference price to deviate from, so the analogue is the pool's own
imbalance.

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
