# Mantua v2 — Open Decisions Memo

**Status:** Recommendations, not commitments. Mark each `✅ ACCEPTED` or `❌ REJECTED` (with note) once reviewed. Decisions block downstream phases — see `Blocks` column in the v2 task list.

**Convention:** Every decision below has a TL;DR recommendation, the reasoning, the alternatives considered, and (where relevant) what external input we'd need (legal, audit firm, etc.) before locking it in.

---

## Summary table

| ID    | Decision                                  | Recommendation                                                                                                                                              | Confidence                                | Needs external input?                                     |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| D-002 | Promote DynamicFee / RWAGate / ALO hooks  | Stable Protection only at v2 launch; DynamicFee in v2.1; RWAGate/ALO deferred                                                                               | High                                      | Audit firm (D-003) for DynamicFee                         |
| D-003 | External security audit                   | YES — mandatory                                                                                                                                             | Very high                                 | Audit firm engagement                                     |
| D-004 | Hosting target                            | Vercel (FE) + Railway/Fly.io (BE) + Neon (DB)                                                                                                               | High                                      | None                                                      |
| D-005 | Privy login methods                       | email + Google + Apple + passkey + external wallet (skip SMS)                                                                                               | High                                      | None                                                      |
| D-006 | Embedded wallet auto-create               | `users-without-wallets`                                                                                                                                     | High                                      | None                                                      |
| D-007 | WalletConnect                             | YES — enable                                                                                                                                                | High                                      | None                                                      |
| D-008 | Privy wallet vs separate CDP agent wallet | Separate CDP wallet                                                                                                                                         | High                                      | None                                                      |
| D-009 | Per-wallet daily spending cap             | YES — keep, $500 default, tiered raise                                                                                                                      | High                                      | None                                                      |
| D-010 | Mantua fee rate                           | Flat 10 bps; tighten `MAX_FEE_BPS` from 50 → 25                                                                                                             | Medium                                    | None (legal weighs on D-012)                              |
| D-011 | Fee recipient                             | Safe multisig, 2-of-3 minimum, 3-of-5 preferred                                                                                                             | Very high                                 | Choose signers                                            |
| D-012 | Legal review before fee collection        | YES — non-negotiable                                                                                                                                        | Very high                                 | Crypto-native counsel                                     |
| D-013 | LLM provider (intent parser)              | Anthropic primary, OpenAI fallback                                                                                                                          | Medium                                    | None                                                      |
| D-014 | Intent parser confidence threshold        | 0.85 execute / 0.65–0.85 clarify / <0.65 reject                                                                                                             | Medium                                    | Tune in beta                                              |
| D-106 | x402 payments — scope, non-goals, gate    | Build gate locked (hardening first); shipped buyer+seller surfaces documented; forward scope and open questions marked for review                           | High (facts); open questions undecided    | Counsel (open question: D-012 posture for seller revenue) |
| D-112 | Launch chain: Base vs Arc mainnet          | Base remains primary; Arc mainnet possible — decide after 2026-09-17; chain-committing work paused until then           | High (process) | Owner decision after 2026-09-17    |
| D-110 | Wallet-stack reconciliation               | Privy stays for user custody (no RainbowKit/wagmi); Circle DCW for the agent                                                                                | High                                      | None                                                      |
| D-111 | Gasless user transactions (C-005/C-006)   | Privy smart wallets (ERC-4337 over the embedded signer) + a dashboard-configured sponsoring paymaster; shipped env-gated OFF pending paymaster provisioning | High (architecture); live path unverified | None (operator provisions the paymaster policy)           |

---

## D-002 — Promote DynamicFee / RWAGate / ALO hooks to Base Mainnet?

**Recommendation:** Ship Stable Protection only at v2 launch. Promote DynamicFee in a v2.1 patch (after audit). Defer RWAGate and ALO to v2.x.

**Why:**

- **Stable Protection** is already deployed on Base Mainnet and limited to stablecoin pairs. Risk surface is bounded.
- **DynamicFee** is high-value (volatile pairs like ETH/cbBTC benefit from it) and the Chainlink dependency is a known quantity, but it touches every swap fee — bug = silent overcharge or undercharge of every LP. Audit-first.
- **RWAGate** introduces compliance gating (KYC, institutional allowlists). That's a separate product surface with legal implications. Don't bundle into v2 launch.
- **ALO** (async limit orders) is user-popular but the async settlement adds infra complexity (off-chain matching, expiry management). Punt to v2.x unless there's a specific user demand we're missing.

**Alternatives considered:**

- Ship all four at launch: too much audit scope, too much risk surface, slower path to launch.
- Ship none: leaves Stable Protection deployed-but-unused; wasteful.

**Blocks:** Phase 5 (P5-007, P5-011, P5-014).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-003 — External security audit before launch?

**Recommendation:** YES — mandatory. Engage a credible firm (Spearbit, Trail of Bits, OpenZeppelin, ChainSecurity) for the hook scope.

**Why:**

- Public mainnet launch with no allowlist gate. The Stable Protection hook sits in the swap path of every USDC/EURC trade — a single bug touches real user money.
- Even if scope is limited to Stable Protection at launch, the Mantua fee path (Phase F) and Permit2 swap flow are also load-bearing.
- Fee collection on mainnet escalates the legal posture (see D-012); skipping audit makes that posture worse.

**Estimated cost:** $30k–$80k for hook + integration scope, 3–5 weeks calendar time. Budget for one round of fixes + re-review.

**Don't fool yourself:** Internal review is not a substitute. Even audited hooks ship with bugs; un-audited ones ship with disasters.

**Blocks:** Phase 9 (P9-004), gates public launch.

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-004 — Hosting target

**Recommendation:** Vercel (frontend) + Railway or Fly.io (Express backend) + Neon (Postgres).

**Why:**

- **Vercel:** best DX for Vite + React, edge functions if needed, painless TLS, integrates with most observability. Free tier covers staging.
- **Railway / Fly.io:** Express + WebSocket support, easy `Dockerfile` deploys, regional control. Pick one — Fly is cheaper at scale, Railway is simpler to ship.
- **Neon:** serverless Postgres with branching (good for staging environments), generous free tier, native Drizzle ORM support.
- **Reject Replit for production:** fine for early prototyping, not where you want a money-handling app's source of truth. Vendor lock-in to a less mature production runtime.
- **Reject self-hosted (AWS/GCP raw):** ops overhead disproportionate to a small team. Revisit at >100k MAU.

**Blocks:** Phase 9 (P9-005), gates deployment.

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-005 — Privy login methods

**Recommendation:** Enable email, Google, Apple, passkey, and external wallet. Skip SMS.

**Why:**

- Email + Google + Apple covers ~95% of consumer logins.
- Passkey is increasingly expected for crypto-native UX; low friction, high security.
- External wallet (MetaMask, Rainbow, etc.) handles the power-user segment that already has wallets.
- **SMS skipped:** costs money per OTP, SIM-swap is a known attack on crypto wallets, fraud surface. The benefit (slightly broader login coverage) is not worth the cost.

**Blocks:** Phase 2 (P2-010, P2-012).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-006 — Privy embedded wallet auto-create

**Recommendation:** `createOnLogin: 'users-without-wallets'`.

**Why:**

- Email/Google/Apple logins → no wallet exists → auto-create an embedded wallet (best DX, user lands ready to transact).
- External wallet login (MetaMask) → user already has a wallet → don't create another. `'all-users'` would create a Privy wallet alongside their MetaMask wallet, leading to balance confusion ("why do I have two ETH balances?").
- `'off'` would block email/Google/Apple users from transacting without a separate wallet-connection step. Bad onboarding.

**Blocks:** Phase 2 (P2-010, P2-011).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-007 — WalletConnect for external mobile wallets

**Recommendation:** YES — enable. Free WC project ID, low integration cost, broad mobile coverage.

**Why:**

- Spec marks it OPTIONAL. The cost of enabling is one env var (`VITE_WALLETCONNECT_PROJECT_ID`) and a few lines of Privy config.
- Without it, mobile users with Rainbow / Trust / Coinbase Wallet / Zerion can't connect. That's a meaningful chunk of the crypto mobile audience.
- Enabling at launch avoids a v2.1 patch and avoids a "your wallet doesn't work" support burden.

**Blocks:** Phase 2 (P2-010, P2-011).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-008 — Privy embedded wallet as agent wallet, OR separate CDP wallet?

**Recommendation:** Separate CDP wallet, explicitly funded by the user. Do not give the agent control of the user's primary wallet.

**Why:**

- The user's Privy embedded wallet holds their primary funds. An agent — by design — makes autonomous decisions (or LLM-parsed decisions). Giving an autonomous actor signing rights over the user's main funds is a direct line from "agent bug" to "user lost everything."
- **CDP wallet as a separate entity:**
  - User funds it explicitly with a budget (e.g. "deposit $500 for the agent to manage").
  - Agent's blast radius is bounded by that wallet's balance.
  - Per-agent spending caps (P6-011) work cleanly because the cap is at the wallet, not at the user level.
  - User can "unfund" the agent by sweeping the CDP wallet back to their primary wallet.
- **Mental model:** Zapier doesn't get your Gmail password. The agent doesn't get your wallet keys.

**Blocks:** Phase 6 (P6-000, P6-003).

**Decision:** ✅ ACCEPTED — 2026-04-30 (P6-000) — wallet boundary locked into `docs/architecture.md` "CDP agent wallet (Phase 6)" → "Wallet boundary" section.

---

## D-009 — Per-wallet daily spending cap on public launch

**Recommendation:** YES — keep. $500/day default, tiered raise based on account age.

**Proposed structure:**

- Day 0–30: hard cap $500/day, user can lower but not raise.
- Day 31–90: user can raise to $10k/day with double-confirmation.
- Day 91+: user can raise to $50k/day with double-confirmation.
- Hard ceiling: $50k/day for all users until v2.1. Disable cap only by signed admin action, never by the agent.

**Why:**

- Without an allowlist gate, the cap is the only standing rail against UI bugs, compromised LLM intent, panic UX, or compromised sessions.
- $500 is a deliberate "you won't lose your house" floor — high enough that 95% of normal use isn't blocked, low enough that the worst case is recoverable.
- Tiered raise rewards account age (a proxy for "this is a real user, not a one-off compromised session").
- Cap is per-wallet, not per-user — agent wallets get their own cap (P6-011).

**Blocks:** Phase 1 (P1-001, P1-002).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-010 — Mantua fee rate

**Recommendation:** Flat 10 bps (0.10%) at launch. Tighten code-level `MAX_FEE_BPS` from 50 → 25.

**Why:**

- Aggregator/wrapper fees in market range from ~5–30 bps. Jupiter takes 5–20, 1inch ~10. 10 bps is competitive.
- Flat is much easier to communicate to users than tiered or variable. ("10 bps Mantua fee" beats "fee depends on pair, time, and volume.")
- Tiered/variable can be added in v2.1 if data shows it's worth the complexity. Don't pre-optimize.
- **Hard cap tightening:** the spec sets `MAX_FEE_BPS = 50` (0.50%). At 0.50% Mantua fee + 0.30% LP fee + slippage, a swap can feel like 1%+ to users. Cap at 25 bps gives admin headroom without enabling user-perceptible overcharge.

**Why "Medium" confidence:** rate selection has a revenue/competitiveness tradeoff that's market-sensitive. Worth a one-week monitor period at 10 bps before locking it in long-term.

**Blocks:** Phase F (PF-005, PF-007, PF-008).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-011 — Fee recipient address

**Recommendation:** Safe multisig. 2-of-3 minimum; 3-of-5 preferred.

**Suggested signer composition (3-of-5):**

1. Founder / CEO (hot key)
2. Technical lead (hot key)
3. Ops / finance lead (hot key)
4. External trusted party / advisor (cold)
5. Cold storage / hardware wallet (recovery)

**Why:**

- **Reject EOA:** single private key controlling fee revenue is a single point of failure. Key compromise = loss of all accumulated fees. Standard pattern says "don't."
- **Multisig threshold tradeoff:** 2-of-3 is the floor for "any one signer compromised does not lose funds." 3-of-5 adds resilience against signer unavailability (vacation, illness) without losing the security property.
- **Withdrawal rights:** only multisig signers via Safe transactions. No "admin" key bypass.
- The fee-admin key (used to update `rate_bps`) is separate from the recipient key. Admin key updates config; recipient key holds funds. Don't merge.

**Blocks:** Phase F (PF-005, PF-006).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-012 — Legal review before fee collection

**Recommendation:** YES — non-negotiable. Engage crypto-native counsel before turning on `portionBips > 0` in production.

**Why:**

- Taking fees on mainnet may classify Mantua as a money transmitter, exchange, or broker depending on jurisdiction:
  - **US:** state-by-state MTL regimes; FinCEN registration may be triggered; some states (NY BitLicense) are particularly stringent.
  - **EU:** MiCA brings new licensing categories for crypto-asset service providers.
  - **UK / Singapore / others:** each have their own framework; not safe to assume US-only.
- Fee collection is the line between "free tool" and "regulated financial service." It's possible to ship a swap aggregator without fees and be defensible as infrastructure; once fees flip on, the analysis changes.
- Counsel will likely also weigh in on Terms of Service, Privacy Policy, geofencing requirements, and KYC obligations — those are P9-009 dependencies anyway.

**Estimated cost:** $10k–$30k for a crypto-native firm (Anderson Kill, Cooley, Latham, McDermott, Allen Overy) for a memo + ToS review. Budget 4–6 weeks calendar.

**Blocks:** Phase F (PF-005), gates public launch.

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-013 — LLM provider for intent parser

**Recommendation:** Anthropic (Claude) primary, OpenAI (GPT) fallback for availability.

**Why:**

- Intent parsing for financial actions is the highest-stakes LLM call in the product. Misparsing "swap 10 USDC" → "swap 10 ETH" is a real loss event. Provider selection is mostly about quality on structured output and instruction following.
- **Claude:** Sonnet 4.6 / Opus 4.6 perform very well on structured-output / function-calling benchmarks. Native support for tool use and JSON mode.
- **OpenAI:** GPT-4.1 / GPT-5 are competitive; native function calling and structured outputs are mature.
- **Why fallback at all:** availability. If Anthropic has an outage and we have no fallback, the entire NL command bar goes down. Fallback to GPT keeps the product working.
- **Cost:** roughly comparable per token for the relevant models. Caching (which the safety rail in PN-010 makes easy — same prompt, multiple users) brings costs down further.

**Why "Medium" confidence:** which-provider-is-best changes month-to-month. Lock the provider abstraction (`parseIntent` function) so swaps are a one-line change, then re-evaluate quarterly.

**Blocks:** Phase N (PN-001, PN-003).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-014 — Intent parser confidence threshold

**Recommendation:** 0.85 execute / 0.65–0.85 clarify / <0.65 reject.

**Behavior:**

- Confidence ≥ 0.85: present the parsed intent in a preview card → user confirms → execute.
- Confidence 0.65–0.85: ask a clarifying question instead of presenting the preview ("Did you mean swap 10 USDC for ETH, or 10 ETH for USDC?").
- Confidence < 0.65: reject with "I'm not sure what you meant — can you rephrase?"

**Why:**

- 0.85 is conservative. The cost of a bad parse is much higher than the cost of an extra clarification question. Err on the side of asking.
- 0.65 floor prevents the parser from confabulating intents from gibberish input.
- These are calibration starting points; tune in beta (PN-011) once we have ground-truth labeled prompts. Track false-clarify rate (asked when shouldn't have) and false-execute rate (didn't ask when should have).
- Independent of confidence: the user-facing confirmation modal (P1-004, PN-010) is mandatory. Confidence threshold gates clarification, not execution.

**Why "Medium" confidence:** thresholds are empirical. Adjust based on observed parser quality.

**Blocks:** Phase N (PN-004).

**Decision:** ⬜ ACCEPTED / ⬜ REJECTED — _notes:_

---

## D-106 — x402 payments: scope, non-goals, and the build gate

**Decision:** ✅ ACCEPTED — 2026-09-04 (owner lock): **no x402 build starts before
the C-wave hardening lands**, and this record — not the C-007 ledger row — is
x402's scope source of truth. The forward scope below is grounded in what the
tree actually ships; genuinely open product questions are marked ⬜ and are NOT
decided here — review is requested on those before any build spec is written.

**What exists today (verified in the tree at `a52e2b8`).** Two shipped surfaces,
both env-gated off by default, with no roadmap rows and no tests:

- **Buyer** (`server/src/lib/x402-buyer.ts`) — HTTP-native x402 v2: discovery via
  the Bazaar index (`withBazaar` over the public facilitator); payment via
  `wrapFetchWithPayment` (`@x402/fetch`) signing an **EIP-3009
  `transferWithAuthorization`** with the buyer EOA — the facilitator settles
  USDC on Base (`eip155:8453`), so the buyer needs USDC only, no gas. Rails:
  `X402_MAX_CALL_USD` per-call ceiling (default $0.10), `X402_DAILY_CAP_USD`
  daily ceiling (default $1.00) summed from the `agent_x402` audit rows, one
  audit row per payment. Surfaces as two chat tools in `agent-chat.ts`
  (`search_paid_services`, `call_paid_service`). Buyer key:
  `X402_BUYER_PRIVATE_KEY`, falling back to `MANTUA_ADMIN_PRIVATE_KEY`.
- **Seller** (`server/src/routes/x402-service.ts`) — Mantua sells
  `GET /api/x402/analyst-brief` for **$0.01 USDC** via
  `paymentMiddlewareFromConfig` (`@x402/express`), scheme `exact`, settled by
  the default public facilitator to `X402_SELLER_ADDRESS`. "Payment IS the
  auth" — no Privy session; an unset address reports 503 `X402_SELLER_DISABLED`
  (the same graceful-dark pattern as the other opt-in features).
- **Key separation** — the buyer EOA is separate from the Circle agent wallet;
  x402 spend never touches the agent wallet's balances or its daily cap
  (`docs/x402-setup.md`).

**Scope — what "building x402" means going forward.** Any new x402 surface
beyond the two shipped ones: additional paid endpoints, new buyer integrations
or surfaces, changes to keys/settlement/facilitator, or flipping x402 from
env-gated-off to default-on. Each such build needs its own spec'd work with
roadmap rows and tests (today's surfaces have neither), and each waits for the
C-wave: the hardening wave defines what "success" and "settled" mean on the
money rails x402 pays through.

**Non-goals.**

- x402 never signs with, or funds from, the user's Privy wallet — the D-008/D-110
  wallet boundary applies unchanged; the only x402 key is the separate,
  operator-configured buyer EOA.
- x402 spend never draws on the Circle agent wallet's budget or its daily cap —
  the caps that bound x402 are its own (`X402_MAX_CALL_USD` /
  `X402_DAILY_CAP_USD`).
- This wave does not build x402 — it authors this record (C-007's missing source
  of truth) and reconciles the ledger.

**Genuinely open (⬜ — not decided here):**

- Dedicated buyer key vs. the `MANTUA_ADMIN_PRIVATE_KEY` default (operational;
  the env already supports `X402_BUYER_PRIVATE_KEY`).
- Whether Mantua lists more of its own services on the Bazaar marketplace beyond
  the analyst brief (product).
- Whether the D-012 legal-review posture extends to x402 seller revenue (counsel
  input; not assumed either way).
- Production cap defaults ($0.10 / $1.00 are dev-era values), and whether the
  shipped surfaces get roadmap rows + tests or stay acknowledged-and-deferred
  under TD-005.

**Blocks:** C-007 (x402 integration) — and is itself gated by the C-wave
hardening items (owner lock, 2026-09-04).

---

## D-110 — Wallet-stack reconciliation: RainbowKit vs Privy vs Circle Wallets

**Decision:** ✅ ACCEPTED — 2026-09-02.

**Context.** The reconciliation request presumed an existing RainbowKit
implementation carrying multiple testnets and a chain switcher, to be squared
with the single-chain chainless product requirement and the Circle Wallets
target for Phase 1.

**Finding: there is no RainbowKit implementation in this codebase.** A full
sweep found no `@rainbow-me/*` or `wagmi` dependency and no RainbowKit code —
the only traces are bundled wallet brand-logo assets referenced in
`LoginModal.tsx` and a stale roadmap row. The user wallet stack is
**Privy only** (`@privy-io/react-auth`, embedded + external wallets). The
multi-testnet configuration (Base Sepolia 84532 + Arc Testnet 5042002) and the
chain-switcher UI **did** exist and were removed on 2026-09-02 in the Base
Mainnet migration and the chainless-UI pass; the design prototype's network
chip (`src/app.jsx:148-160`) is a hand-rolled lookalike, single-entry, never
RainbowKit. Any RainbowKit implementation being remembered belongs to a
predecessor repo (the 2026-03 `MantuaAI` era), not this tree.

**Decisions.**

1. **User custody: Privy stays. RainbowKit and wagmi will not be adopted.**
   RainbowKit's core value is a wallet-picker plus a chain-switcher UI; the
   chainless product decision forbids the switcher, and Privy already covers
   the rest (external wallets + WalletConnect per D-005/D-007) while adding
   embedded wallets RainbowKit does not have. wagmi would add a parallel hook
   layer over the same viem clients `client/src/lib/privy/wallet-client.ts`
   already builds directly.
2. **Agent custody: Circle Developer-Controlled Wallets is the Phase 1
   target — confirmed and already implemented** (`server/src/lib/circle/`).
   This supersedes the _provider naming_ of D-008 ("separate CDP wallet");
   D-008's wallet-boundary rationale — the agent never touches the user's
   keys, blast radius bounded to an explicitly funded wallet — carries over
   to Circle unchanged.
3. **Circle user-facing wallets (user-controlled / modular passkey) are
   explicitly out of scope for Phase 1** user custody. Recorded as a future
   option to revisit only if Privy becomes a constraint (pricing, passkey
   requirements) — an evaluation, not a planned migration.

**Migration path** (status as of 2026-09-02):

| #   | Step                                                                                                                                                                                                        | Status                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Strip testnets; single chain Base Mainnet 8453                                                                                                                                                              | ✅ done (mainnet migration)                                                                                                                                                                             |
| 2   | Remove chain switcher + all visible chain UI                                                                                                                                                                | ✅ done (chainless-UI pass)                                                                                                                                                                             |
| 3   | Strike wagmi from the roadmap; P2-013 is the direct Privy → viem bridge, shipped in `wallet-client.ts`                                                                                                      | ✅ done (this decision)                                                                                                                                                                                 |
| 4   | Delete residual chain-switch machinery (`chain-context.tsx` collapse, dead `NETWORK_OPTIONS`)                                                                                                               | ⬜ per reusability audit                                                                                                                                                                                |
| 5   | Circle DCW Phase 1 hardening — exit criteria: execute-to-confirmed-receipt (not `SENT`), `CIRCLE_WALLET_SET_ID` pinned + hard-fail when unset, mainnet Gas Station policy verified, bounded agent approvals | 🟡 in progress — C-wave (`docs/tasks/circle-custody-wave.md`): receipt → C-015, Gas Station → C-017, bounded approvals ✅ code-side (PR #18), wallet-set ✅ code-side (PR #13) pending the operator pin |
| 6   | Update `docs/architecture.md` wallet section from the stale CDP-SDK narrative to Circle DCW                                                                                                                 | ✅ done (this decision)                                                                                                                                                                                 |

**Non-goals:** RainbowKit, wagmi, any multi-chain wallet UI, and Circle
user-controlled wallets for user custody.

---

## D-111 — Gasless user transactions: Privy smart wallets + sponsoring paymaster

**Decision:** ✅ ACCEPTED — 2026-09-04. Implemented behind `VITE_GASLESS_ENABLED`
(OFF by default) in branch `027-gasless-user-transactions`; see
`docs/tasks/027-gasless-user-transactions.md` for status and operator steps.

**Context.** C-005 requires that users never acquire, hold, or manage ETH.
The AGENT side is already gasless: Circle Gas Station sponsors the agent's
Circle SCA wallets (C-017 wave). The USER side is not — user writes come from
Privy wallets (embedded EOAs or external wallets), which pay their own ETH
gas on Base. Every user trade today silently assumes the user holds ETH.

**Options evaluated.**

**(a) Privy smart wallets (ERC-4337) + a sponsoring paymaster — CHOSEN.**
Grounded against the installed `@privy-io/react-auth@3.22.2` (not docs from
memory): the package ships a `./smart-wallets` entrypoint exporting
`SmartWalletsProvider` and `useSmartWallets`, whose `getClientForChain`
returns a permissionless-based `SmartAccountClient` wrapping the user's
**embedded** signer — `sendTransaction` submits a sponsored user operation
through the bundler + paymaster configured **per chain in the Privy
Dashboard** (the client optionally forwards a `paymasterContext` object).
The entrypoint needs the optional peer dep `permissionless` (now pinned
`0.2.57` in `client/package.json`). Paymaster choices that slot into the
dashboard's paymaster-URL field, in preference order:

1. **Circle Paymaster** (ERC-4337 verifying paymaster on Base) — gas paid
   in USDC, which matches the USDC-native platform posture (C-004) and the
   Circle stack already operating the agent side. Users would spend cents of
   USDC per trade rather than the operator sponsoring outright.
2. **A bundler provider's sponsoring paymaster** (Pimlico / Alchemy Gas
   Manager / Coinbase Developer Platform) — operator-funded sponsorship
   policy; simplest "user pays nothing at all" experience, with policy caps
   as the abuse rail.

The final pick is an **operator/dashboard decision**, not a code fork — the
client code is identical for both (that is much of why (a) wins).

Honest caveats, which are why the flag ships OFF:

- **Embedded wallets only.** Privy provisions smart wallets over the
  embedded signer. External-wallet logins (MetaMask, WalletConnect…) stay on
  the EOA path and keep paying their own gas. Acceptable: the "never touch
  ETH" persona is precisely the embedded-wallet (email/Google) user;
  external-wallet users self-custody by choice.
- **New address.** The smart account's address differs from the embedded
  EOA's. USDC balances, allowances, YES-token positions, and the
  deposit/receive surfaces all key on the active address — existing users
  with funds on the EOA need a one-time sweep, and portfolio/receive UI
  needs an address-reconciliation pass before the flag can default ON.
  Flag-ON behavior is self-consistent (trades, allowance checks, and
  position reads all go through the same smart-account address) but a user
  who traded before the flip would see their prior balances "missing".
- **Unverifiable offline.** Sponsorship requires a funded paymaster policy
  and dashboard config; no offline test can prove the end-to-end flow
  (C-006). The wired code path is verified by unit tests only.

**(b) Circle Modular Wallets (passkey SCA + Gas Station) for users —
REJECTED.** It would deliver the same gasless outcome, and it is the one
option that unifies user+agent sponsorship under Circle Gas Station. But it
directly conflicts with D-110 ("Privy stays for user custody"; Circle
user-facing wallets "explicitly out of scope for Phase 1 … revisit only if
Privy becomes a constraint"). Adopting it means replacing the login stack
(email/Google → passkey WebAuthn), running two user-wallet systems through a
migration, and rebuilding the Privy-keyed auth/session plumbing — a full
custody migration to solve a gas-sponsorship problem that (a) solves inside
the incumbent stack. Privy has not become a constraint; D-110's revisit
trigger has not fired.

**(c) Status quo + ETH funding UX — REJECTED.** A "top up ETH for network
fees" flow fails C-005 verbatim (users must acquire/hold/manage ETH) and
cannot be built without violating the chainless rule — funding UX has to
name ETH, gas, and a chain. It is the only option that is worse than doing
nothing, because it enshrines the problem in UI.

**Blocks:** C-006 (live verification), flag default-ON rollout.

**Non-goals:** changing the agent-side sponsorship (Circle Gas Station,
C-017); batching approve+trade into one user operation (a natural follow-up
once the path is live — the smart-account client supports call batching);
any chain- or gas-naming UI copy.

---

## D-112 — Launch chain: Base vs Arc mainnet (decision window)

**Status:** ⏳ OPEN — owner decides after **2026-09-17**. Base remains the
working assumption; Arc mainnet is a live alternative.

**What is PAUSED until the decision** (owner call, 2026-09-05):
- C-001 mainnet half (Circle LIVE entitlement chase, mainnet entity secret,
  Gas Station billing) — the testnet half stays done and valid either way.
- C-006 (both the interactive zero-ETH test and the full walkthrough).
- P9-013 real deployment (the fork rehearsal stands; it exercises scripts,
  not the chain choice).

**Pivot-cost inventory** (what an Arc launch would change — kept current so
the decision is priced, not guessed):

| Area | Base → Arc impact |
| --- | --- |
| Chain constants/registries (`chains.ts` ×2, tokens, RPC, explorer) | Config swap — the per-chain map shapes were kept schema-stable in the migration for exactly this |
| Uniswap v4 | **No canonical deployment on Arc** — every pool stack becomes self-deployed (the DM stack already is; base-pair pools and the UniversalRouter/Permit2 swap path would need Arc equivalents or the PoolSwapTest-style periphery) |
| DM-112 routing | Trading API (Uniswap-hosted) is Base-only — base-pair routing collapses onto self-deployed stacks on Arc |
| Gas / gasless | Arc uses **USDC as native gas** — C-005's Privy+Pimlico work is Base-specific; on Arc the ETH problem doesn't exist (fees are USDC), so C-005/C-006 restate rather than port |
| Circle agent stack | Ports cleanly — DCW supports Arc blockchains natively (the June wallets were ARC-TESTNET); Gas Station/e2e re-run with Arc ids |
| CCTP bridge / unified balance | Arc-mainnet availability to be verified at decision time |
| Chainless UI | Unaffected by design — no user-facing chain references exist |

**Meanwhile:** work proceeds only on chain-agnostic phases (B7 trading page,
B9-005 execution engine, B10 E2Es, design-debt follow-ups). Nothing merged
before 2026-09-17 may hard-commit the chain beyond existing config.

---

## What needs external input before any decision is final

| Decision | External input required                                                    |
| -------- | -------------------------------------------------------------------------- |
| D-003    | Engage audit firm; lock scope and timing                                   |
| D-011    | Pick the 3 (or 5) multisig signers                                         |
| D-012    | Engage crypto-native counsel; get written memo before fee collection ships |

Everything else can be locked by an internal call.

---

## Side note on PD-001

PD-001 in the v2 task list says "Fetch design files: `Mantua Prototype.html` + README." The design package we received contained only the HTML — no README. Two ways to resolve:

1. **Drop the README requirement** — the prototype HTML is self-describing for design-system extraction.
2. **Author a brief design notes doc** — capture any non-obvious constraints (responsive breakpoints, accessibility rules, chain-lock behavior) so design tokens have a written source.

Recommendation: Option 2, but only if any of those constraints actually exist. Otherwise the prototype is the spec.

---

_Last updated: 2026-09-04_
