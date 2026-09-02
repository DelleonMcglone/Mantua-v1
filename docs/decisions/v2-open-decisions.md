# Mantua v2 — Open Decisions Memo

**Status:** Recommendations, not commitments. Mark each `✅ ACCEPTED` or `❌ REJECTED` (with note) once reviewed. Decisions block downstream phases — see `Blocks` column in the v2 task list.

**Convention:** Every decision below has a TL;DR recommendation, the reasoning, the alternatives considered, and (where relevant) what external input we'd need (legal, audit firm, etc.) before locking it in.

---

## Summary table

| ID    | Decision                                  | Recommendation                                                                | Confidence | Needs external input?             |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------- | ---------- | --------------------------------- |
| D-002 | Promote DynamicFee / RWAGate / ALO hooks  | Stable Protection only at v2 launch; DynamicFee in v2.1; RWAGate/ALO deferred | High       | Audit firm (D-003) for DynamicFee |
| D-003 | External security audit                   | YES — mandatory                                                               | Very high  | Audit firm engagement             |
| D-004 | Hosting target                            | Vercel (FE) + Railway/Fly.io (BE) + Neon (DB)                                 | High       | None                              |
| D-005 | Privy login methods                       | email + Google + Apple + passkey + external wallet (skip SMS)                 | High       | None                              |
| D-006 | Embedded wallet auto-create               | `users-without-wallets`                                                       | High       | None                              |
| D-007 | WalletConnect                             | YES — enable                                                                  | High       | None                              |
| D-008 | Privy wallet vs separate CDP agent wallet | Separate CDP wallet                                                           | High       | None                              |
| D-009 | Per-wallet daily spending cap             | YES — keep, $500 default, tiered raise                                        | High       | None                              |
| D-010 | Mantua fee rate                           | Flat 10 bps; tighten `MAX_FEE_BPS` from 50 → 25                               | Medium     | None (legal weighs on D-012)      |
| D-011 | Fee recipient                             | Safe multisig, 2-of-3 minimum, 3-of-5 preferred                               | Very high  | Choose signers                    |
| D-012 | Legal review before fee collection        | YES — non-negotiable                                                          | Very high  | Crypto-native counsel             |
| D-013 | LLM provider (intent parser)              | Anthropic primary, OpenAI fallback                                            | Medium     | None                              |
| D-014 | Intent parser confidence threshold        | 0.85 execute / 0.65–0.85 clarify / <0.65 reject                               | Medium     | Tune in beta                      |

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

_Last updated: 2026-04-26_
