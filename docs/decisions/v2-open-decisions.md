# Mantua v2 — Open Decisions Memo

**Status:** Recommendations, not commitments. Mark each `✅ ACCEPTED` or `❌ REJECTED` (with note) once reviewed. Decisions block downstream phases — see `Blocks` column in the v2 task list.

**Convention:** Every decision below has a TL;DR recommendation, the reasoning, the alternatives considered, and (where relevant) what external input we'd need (legal, audit firm, etc.) before locking it in.

---

## Summary table

| ID    | Decision                                                                                                                   | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                              | Confidence                                                  | Needs external input?                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| D-002 | Promote DynamicFee / RWAGate / ALO hooks                                                                                   | Stable Protection only at v2 launch; DynamicFee in v2.1; RWAGate/ALO deferred                                                                                                                                                                                                                                                                                                                                                               | High                                                        | Audit firm (D-003) for DynamicFee                                     |
| D-003 | External security audit                                                                                                    | YES — mandatory                                                                                                                                                                                                                                                                                                                                                                                                                             | Very high                                                   | Audit firm engagement                                                 |
| D-004 | Hosting target                                                                                                             | Vercel (FE) + Railway/Fly.io (BE) + Neon (DB)                                                                                                                                                                                                                                                                                                                                                                                               | High                                                        | None                                                                  |
| D-005 | Privy login methods                                                                                                        | email + Google + Apple + passkey + external wallet (skip SMS)                                                                                                                                                                                                                                                                                                                                                                               | High                                                        | None                                                                  |
| D-006 | Embedded wallet auto-create                                                                                                | `users-without-wallets`                                                                                                                                                                                                                                                                                                                                                                                                                     | High                                                        | None                                                                  |
| D-007 | WalletConnect                                                                                                              | YES — enable                                                                                                                                                                                                                                                                                                                                                                                                                                | High                                                        | None                                                                  |
| D-008 | Privy wallet vs separate CDP agent wallet                                                                                  | Separate CDP wallet                                                                                                                                                                                                                                                                                                                                                                                                                         | High                                                        | None                                                                  |
| D-009 | Per-wallet daily spending cap                                                                                              | YES — keep, $500 default, tiered raise                                                                                                                                                                                                                                                                                                                                                                                                      | High                                                        | None                                                                  |
| D-010 | Mantua fee rate                                                                                                            | Flat 10 bps; tighten `MAX_FEE_BPS` from 50 → 25                                                                                                                                                                                                                                                                                                                                                                                             | Medium                                                      | None (legal weighs on D-012)                                          |
| D-011 | Fee recipient                                                                                                              | Safe multisig, 2-of-3 minimum, 3-of-5 preferred                                                                                                                                                                                                                                                                                                                                                                                             | Very high                                                   | Choose signers                                                        |
| D-012 | Legal review before fee collection                                                                                         | YES — non-negotiable                                                                                                                                                                                                                                                                                                                                                                                                                        | Very high                                                   | Crypto-native counsel                                                 |
| D-013 | LLM provider (intent parser)                                                                                               | Anthropic primary, OpenAI fallback                                                                                                                                                                                                                                                                                                                                                                                                          | Medium                                                      | None                                                                  |
| D-014 | Intent parser confidence threshold                                                                                         | 0.85 execute / 0.65–0.85 clarify / <0.65 reject                                                                                                                                                                                                                                                                                                                                                                                             | Medium                                                      | Tune in beta                                                          |
| D-102 | Licensed sports data provider (S-001/S-002)                                                                                | Sportradar NFL API v7 primary behind the existing provider abstraction; SportsDataIO held as the negotiation alternative; ESPN stays prototyping-only fallback                                                                                                                                                                                                                                                                              | High (architecture); contract unsigned                      | Operator signs the Sportradar commercial agreement                    |
| D-103 | Market mechanism (P-001)                                                                                                   | ✅ CLOSED 2026-09-06 — full-collateral YES/NO vs USDC, single YES/USDC dynamic-fee v4 pool, price = implied probability; **in-play trading: buy/sell any time before or during the event** (owner call, supersedes the kickoff-freeze deferral); trading closes on final, permissionless time backstop                                                                                                                                      | Very high (mechanism shipped); in-play is a contract change | None — owner decided 2026-09-06                                       |
| D-104 | Resolution engine & authority (P-005)                                                                                      | ✅ CLOSED 2026-09-06 — Sportradar finals via the canonical data layer through the S-022…S-026 integrity gates; mandatory dispute window before on-chain submit; audited manual-override path; signer = service key, operator = owner (closes DM-103)                                                                                                                                                                                        | High                                                        | None (window length tunable in ops)                                   |
| D-105 | Dynamic Market Hook fee model (H-001…H-017)                                                                                | ✅ CLOSED 2026-09-11 — regular season 0%; playoffs dynamic 0.10%–0.70% (immutable ceiling); `Fee = C × r × p × (1 − p)` realised as v4 pip fee `r × (1 − p)` on the gross input; season flag per pool at registration from the league calendar; one on-chain `quoteFee` feeds the UI quote                                                                                                                                                  | Very high (owner spec); deployment pending                  | None — owner spec 2026-09-11; deploy waits on D-112 + funded keystore |
| D-106 | x402 payments — scope, non-goals, gate                                                                                     | Build gate locked (hardening first); shipped buyer+seller surfaces documented; forward scope and open questions marked for review                                                                                                                                                                                                                                                                                                           | High (facts); open questions undecided                      | Counsel (open question: D-012 posture for seller revenue)             |
| D-107 | Social platform for agent posting (AE-001)                                                                                 | ✅ CLOSED 2026-09-18 — X (Twitter) via API v2 under an OAuth 1.0a user-context signature; ONE deployment account (four env values: app key/secret, access token/secret) through which every opted-in agent posts under its own handle; missing credentials → recorded dry runs; per-agent OAuth is the recorded next step; the login shared in the task prompt is unused, unstored, and should be rotated                                   | High (shipped, task 070)                                    | Operator provisions the X app and account credentials                 |
| D-112 | Launch chain: Base vs Arc mainnet                                                                                          | Base remains primary; Arc mainnet possible — decide after 2026-09-17; chain-committing work paused until then                                                                                                                                                                                                                                                                                                                               | High (process)                                              | Owner decision after 2026-09-17                                       |
| D-110 | Wallet-stack reconciliation                                                                                                | Privy stays for user custody (no RainbowKit/wagmi); Circle DCW for the agent                                                                                                                                                                                                                                                                                                                                                                | High                                                        | None                                                                  |
| D-111 | Gasless user transactions (C-005/C-006)                                                                                    | Privy smart wallets (ERC-4337 over the embedded signer) + a dashboard-configured sponsoring paymaster; shipped env-gated OFF pending paymaster provisioning                                                                                                                                                                                                                                                                                 | High (architecture); live path unverified                   | None (operator provisions the paymaster policy)                       |
| D-109 | Agent policies — the user's limits on the agent (A-003/A-012/A-038)                                                        | ✅ CLOSED 2026-09-12 — one `agent_policies` row per user (defaults when absent): status, unprompted-trade permission, per-trade stake, risk level, leagues, and a hedge block (max size, max exposure, min confidence, cooldown, daily budget, market types); written only by the user through `PATCH /api/agent/policy`, read by the simulation, the turn context and the hedge executor — the agent has a read tool and no write tool     | High (shipped, task 057)                                    | None                                                                  |
| D-116 | Portfolio valuation sources (PF-011)                                                                                       | ✅ CLOSED 2026-09-12 — market positions marked at the live pool price; assets priced Pyth-first with the DefiLlama fallback until Phase 13's CoinGecko migration (AN-001, owner-gated); the lenient `$0` fallback is observable (`pricing.fallback_zero` counter, `pricing_zero` alert) and enforcement keeps the strict fail-closed helpers                                                                                                | High (shipped, task 066)                                    | None                                                                  |
| D-115 | Unified Activity model — one timeline table, typed kinds, one-way status, added beside the ledgers (PF-014 … PF-017)       | ✅ CLOSED 2026-09-12 — the dormant `activity` table becomes the user-facing timeline: eighteen typed kinds with categories, `actor` user/agent/system, `pending → completed \| failed` exactly once, `(tx_hash, kind)` unique; written best-effort beside `portfolio_transactions` and the audit log at every money write site, read by `GET /api/activity`                                                                                 | High (shipped, task 062)                                    | None                                                                  |
| D-114 | Agent execution protocol — modes, preview → confirm → server-minted id; x402 data is the agent's own spend (A-025 … A-035) | ✅ CLOSED 2026-09-12 — `AGENT_MODE` (disabled / simulation / user_testing default / autonomous); money-moving tools need a preview the user saw plus a single-use confirmation id the server mints from the user's own explicit "confirm"; market trades are re-simulated at execution and refused on material drift; `call_paid_service` (x402 data) is exempt — the agent has direct marketplace access under its own per-call/daily caps | High (shipped, task 055)                                    | None                                                                  |
| D-113 | Live-sports reliability transport & status (R-001/R-004/R-005)                                                             | ✅ CLOSED 2026-09-12 — SSE (not WebSocket) for the live market stream on the single-function API; one public `/api/status` computed from the enforcement points' own inputs and pushed on the stream; trades enter a persisted per-wallet pending register at hash time and leave only on a chain-verified terminal state; game-time ingest every 5 min from GitHub Actions                                                                 | High (shipped, task 051)                                    | None                                                                  |

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

## D-102 — Licensed sports data provider: Sportradar primary, SportsDataIO alternative

**Decision:** ✅ ACCEPTED (technical selection) — 2026-09-06. Sportradar's NFL
API v7 is the licensed PRIMARY sports data provider, integrated behind the
existing `SportsDataProvider` abstraction (S-003, branch
`037-sportradar-provider`). **Status: 🟡 contract unsigned** — the adapter is
code-complete and env-gated (`SPORTRADAR_API_KEY` + `SPORTRADAR_ENV`); the
commercial agreement itself is operator-side work this record cannot close.
SportsDataIO is retained as the priced negotiation alternative. ESPN's
undocumented backend remains the prototyping-only fallback (and the WNBA
source until a WNBA package is licensed) — it carries no contract, no SLA,
and no licence, which is why B3's Risk 1 exists.

**What the Sportradar "NFL" licence actually covers — read this before
negotiating.** Genius Sports — not Sportradar — is the NFL's **exclusive
distributor of real-time official play-by-play, Next Gen Stats, and the
league's official sports-betting data feed**, under a partnership extended
through the **2029 season** ([NFL.com](https://www.nfl.com/news/nfl-extends-strategic-partnership-with-genius-sports),
[SportsPro](https://www.sportspro.com/news/nfl-genius-sports-betting-data-streaming-partnership-extension-june-2025/)).
Sportradar held that role 2015–2021 and walked away when "the economics
became irrational" ([Sports Handle](https://sportshandle.com/sportradar-genius-nfl-data/)).
Sportradar's NFL API v7 — whose URL path (`/nfl/official/…`) is historical
product naming, not a rights claim — is Sportradar's own licensed commercial
NFL product: schedules, boxscores, play-by-play, hierarchy, rosters, weekly
injuries, with documented cache freshness (boxscore: 3s in-progress) and an
SLA-backed contract. That is exactly what Mantua's ingestion needs; Mantua is
not a sportsbook buying the official betting feed. If a regulator or partner
ever requires _the_ official NFL feed, that conversation is with Genius
Sports and is out of this record's scope.

**Access model (verified on developer.sportradar.com, 2026-09-06):**

- **Auth:** single Console master key, `x-api-key` header
  ([authentication](https://developer.sportradar.com/getting-started/docs/authentication)).
- **Trial:** self-service via the Sportradar Console/Marketplace; **1 QPS
  and 1,000 requests per rolling 30 days**
  ([your account](https://developer.sportradar.com/getting-started/docs/your-account)).
  The adapter's pacing + long TTLs are sized to this.
- **Production:** the same endpoints with `production` in the path; keys are
  provisioned under a commercial contract. **Pricing is B2B and not
  published** — Sportradar sells by sport package, feed tier, and usage;
  budget expectation from third-party comparisons is materially above
  SportsDataIO for the same league.
- **MCP:** an official remote MCP server exists
  (`https://developer.sportradar.com/mcp`, `sportradar-football` profile) —
  see S-004 in `docs/tasks/037-sportradar-provider.md`; it is a docs/dev
  tool, not a data plane.

**Comparison (sources fetched 2026-09-06):**

| Dimension                | Sportradar (NFL API v7)                                                                                                                                                                                              | SportsDataIO (NFL)                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage                 | Schedules, boxscore, play-by-play, hierarchy, rosters, weekly injuries, standings; odds/probabilities are a separate Odds package ([NFL overview](https://developer.sportradar.com/football/reference/nfl-overview)) | Scores, schedules, stats, projections, odds aggregated from major sportsbooks, news, injuries ([NFL portal](https://sportsdata.io/developers/api-documentation/nfl))                                            |
| Freshness/latency claims | Published per-feed cache TTLs: boxscore 3s in-progress / 60s scheduled; hierarchy 4h; player profile 15m ([boxscore ref](https://developer.sportradar.com/football/reference/nfl-game-boxscore))                     | No equivalent published per-feed TTL table on the comparison page; markets itself on "24/7/365 monitoring" ([comparison](https://sportsdata.io/sportradar-alternative))                                         |
| Pricing model            | B2B contract, unpublished; enterprise-tier per third-party surveys ([SportsAPI.com](https://sportsapi.com/api-directory/sportradar/))                                                                                | Subscription products, also quote-based at production tier but positioned "more affordable price" than Sportradar, with a "full access free trial" ([comparison](https://sportsdata.io/sportradar-alternative)) |
| Licensing posture        | Licensed data company; sells its own collected NFL feed; official-league partnerships in other sports                                                                                                                | Explicitly "No license restrictions or rights fees required" — aggregation posture, no official-league claim ([comparison](https://sportsdata.io/sportradar-alternative))                                       |
| Trial                    | 1 QPS / 1,000 calls per 30 days, self-service                                                                                                                                                                        | Free trial, full access per marketing; API Replay for off-season testing                                                                                                                                        |
| Tooling                  | Official MCP server (docs/dev-assist), Postman collections, OpenAPI specs                                                                                                                                            | Developer portal, replay tooling, free reference-ID mapping service                                                                                                                                             |

**Why Sportradar primary:** (1) the deepest documented NFL feed set matching
the canonical schema (hierarchy → `teams`, full rosters → `players`, weekly
injuries → `injuries`) with per-feed freshness contracts; (2) provenance —
a first-party collector, not an aggregator, which matters for DM-107's
corroboration logic (an aggregator that itself consumes Sportradar would not
be independent); (3) the trial tier allowed the integration to be built and
verified before any spend. **Why keep SportsDataIO warm:** it is the
credible price lever in the Sportradar negotiation, and its aggregation
posture (odds included) covers the odds gap Sportradar prices separately.

**Non-goals:** buying the Genius Sports official betting feed; licensing
Sportradar's separate Odds Comparison or Images (team-mark) packages —
each is its own decision when the need is real; moving WNBA off ESPN before
a WNBA package is priced.

**Blocks:** S-001 (contract — operator), production `SPORTRADAR_API_KEY`.

---

## D-103 — Market mechanism ✅ CLOSED 2026-09-06

**Decision.** The prediction-market mechanism is the shipped design, with one
owner-directed change: **in-play trading**.

**Mechanism (codifies what is built).**

- Full-collateral binary outcome tokens: `split` locks 1 USDC and mints
  1 YES + 1 NO; `merge` is the exact inverse. Both are exact and fee-free
  (`Market.sol`, `OutcomeToken.sol`, invariants in `MarketInvariant.t.sol`).
- One **YES/USDC** Uniswap v4 pool per market. NO has no pool; a NO position
  is expressed by splitting and holding (or selling YES). Pool price is the
  implied probability under the $0–$1 contract convention;
  `server/src/lib/probability.ts` is the sole price↔probability converter
  (B1-010).
- Pools are dynamic-fee (`DYNAMIC_FEE_FLAG`), tick spacing 60, created with
  the Dynamic Market Hook attached on the self-deployed DM stack (DM-112
  routing). `planMarketPool()` is the single constructor of pool keys.
- Market identity: `marketId` is a keccak commitment over
  (provider event id, market type, outcome index) per `docs/specs/market-id.md`.
  On-chain the factory binds `marketId`, `startsAt`, `label`, `collateral`,
  `resolver`; teams/type/resolution-source are bound **cryptographically**
  through the commitment, and the preimage MUST be persisted server-side at
  creation so the binding is independently recomputable (P-002).

**In-play trading (owner decision, 2026-09-06).** Buy/sell is allowed at any
time **before or during** the event. This supersedes the
`market-lifecycle.md` §3.4 kickoff-freeze deferral. Consequences:

- Trading closes when the event is **final**, not at kickoff. The resolver
  (or operator) freezes on final — a data-driven freeze — and a
  **permissionless time backstop** (`startsAt + MAX_EVENT_DURATION`, default
  12 h) guarantees no market outlives its event if the service is down.
- The hook's freeze enforcement flips from time-at-kickoff to
  market-state-driven with the same time backstop. The kickoff timestamp
  stays registered and immutable (it still anchors the backstop and fee
  dynamics).
- `split`/`merge` remain open while trading is open. Full collateralisation
  makes set-minting against a known score harmless: a set is always worth
  exactly $1.
- Live-play toxic-flow protection is the Dynamic Market Hook's existing
  degradation ladder: dynamic fees, per-trade caps, and the stale-keeper
  clamp (fee → MAX_FEE, cap → MIN_TRADE_CAP). A data-feed outage during play
  additionally halts **server-side quoting** of new trades (P-012) while
  on-chain remains open-but-clamped; feed failure never mis-freezes and
  never mis-resolves (S-022 gates settlement, absence of data is never an
  outcome).
- This is a contract-semantics change: the markets/hook security review and
  the lifecycle E2Es are re-run against the new semantics before any deploy
  (tasks 045, P-013/P-014).

## D-104 — Resolution engine & authority ✅ CLOSED 2026-09-06

**Decision.** Settlement derives exclusively from the licensed provider
(Sportradar per D-102) **via the Mantua canonical data layer** — the
resolution cron routes through `providerFor(league)` like every other
consumer; no direct provider instantiation (fixes the shipped ESPN bypass).
The S-022…S-026 integrity machinery is the only path to an on-chain
resolution: freshness breaker, 9-criteria gate minting the
`ResolutionAuthorization` token, confidence state machine
(`DISPUTED` never auto-resolves).

**Dispute window.** A mandatory delay (`RESOLUTION_DISPUTE_WINDOW_SECONDS`,
default 900) separates the moment an outcome passes the criteria gate from
the on-chain submit. During the window the operator can hold or dispute;
only an unheld, still-VERIFIED outcome submits when the window elapses. The
window's open/close timestamps are recorded on the `resolutions` row.

**Manual override.** An authenticated internal route (operator-gated, same
internal-auth posture as the crons) records method `manual` with a mandatory
note, writes the audit row and the `resolutions` row with the tx hash, and
executes through the `Resolver` operator role. Raw-EOA overrides outside
this path are for recovery only and are reconciled into the same tables
after the fact.

**Authority (closes DM-103).** The `Resolver` contract holds two rotatable
roles: `signer` — the automated service key (`MARKET_SIGNER_PRIVATE_KEY`,
address-routed so a mispasted key refuses to sign) — and `operator` — the
owner-held override key (two-step transfer). Markets pin the Resolver
contract immutably, so keys rotate without orphaning markets. This is the
Mantua-held-resolver-with-manual-override model DM-103 proposed, now
decided; sign-off finding I-01 (keeper = resolver key) carries forward until
the keys are split at mainnet deploy.

**Verifiability (P-010).** Every resolution's tx hash, signer, source
payload, and confidence state are recorded and queryable through an internal
ops surface with BaseScan links. Public user UI stays chainless — no
explorer links or chain branding (the existing MarketDetail explorer link is
removed).

## D-105 — Dynamic Market Hook fee model ✅ CLOSED 2026-09-11

**Decision (owner spec, authoritative).** Trading fees on Mantua market pools
follow the league calendar:

- **Regular season: 0%.** Adoption, liquidity, and activity come first.
- **Playoffs: dynamic 0.10%–0.70%**, set per swap by the Dynamic Market
  Hook from liquidity, volatility, trading activity, and market
  uncertainty. **0.70% is a hard ceiling** — a `constant` in `RiskPolicy`
  with no setter; raising it means a redeploy.
- **Formula:** `Fee = C × fee_rate × p × (1 − p)` — `C` contracts traded,
  `p` the contract price read from the pool. `p(1−p)` peaks at 0.50, so
  50/50 trades carry the highest fee per contract, declining toward 0 and 1.

**How it is enforced.** Uniswap v4 charges the LP fee as a fraction of the
swap's gross input, so the hook returns `feePips = r × (1 − p)`; with `C`
defined as the contract-equivalent of the gross input at the pre-trade
price, `feePips × input == C × r × p × (1 − p)` exactly in every swap shape
(derivation in `docs/tasks/049-dynamic-market-fee-model.md`;
implementation `MarketFeeFormula.sol`).

**Season switch.** `playoffs` is a per-pool boolean written once by the
operator at `registerPool`, taken from the provider's season type
(Sportradar `PST`, ESPN season type 3). A per-pool, write-once flag was
chosen over a global operator switch because the NFL and WNBA calendars
overlap (a global flag would be wrong for one league), because a game's
playoff status is a fact known at creation, and because a flag nobody can
flip mid-market cannot be used to turn fees on or off against traders.
Unknown season type defaults to regular season (0%).

**Quote = execution.** The hook exposes `quoteFee`, a view over the same
code path `beforeSwap` runs. The server's trade build calls it and the UI
prints Position / Estimated fee / Total from that number; no fee logic is
re-derived off-chain except a bit-exact mirror used for display rounding
and tested against shared vectors.

**Rejected.** A global season switch (cross-league wrong, admin-gameable);
counting `C` net of fee (breaks exactness by a factor `1/(1 + r(1−p))`);
keeping the 0.30%–5.00% premium band (contradicts the owner's 0% / 0.70%
rule); a server-side fee calculator as the source of truth (would drift
from the hook).

**Consequence.** `MarketState` and `registerPool` gain `playoffs`; the
`MarketFeeUpdated` event carries the four-driver breakdown, the rate, `p`,
and the season flag; `market_fills` records the fee per trade. The B2
sign-off's fee-band statements (BASE_FEE 0.30%, MAX_FEE 5%) are superseded
— see `docs/security/dynamic-market-fee-review.md`.

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

| Area                                                               | Base → Arc impact                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain constants/registries (`chains.ts` ×2, tokens, RPC, explorer) | Config swap — the per-chain map shapes were kept schema-stable in the migration for exactly this                                                                                                                                |
| Uniswap v4                                                         | **No canonical deployment on Arc** — every pool stack becomes self-deployed (the DM stack already is; base-pair pools and the UniversalRouter/Permit2 swap path would need Arc equivalents or the PoolSwapTest-style periphery) |
| DM-112 routing                                                     | Trading API (Uniswap-hosted) is Base-only — base-pair routing collapses onto self-deployed stacks on Arc                                                                                                                        |
| Gas / gasless                                                      | Arc uses **USDC as native gas** — C-005's Privy+Pimlico work is Base-specific; on Arc the ETH problem doesn't exist (fees are USDC), so C-005/C-006 restate rather than port                                                    |
| Circle agent stack                                                 | Ports cleanly — DCW supports Arc blockchains natively (the June wallets were ARC-TESTNET); Gas Station/e2e re-run with Arc ids                                                                                                  |
| CCTP bridge / unified balance                                      | Arc-mainnet availability to be verified at decision time                                                                                                                                                                        |
| Chainless UI                                                       | Unaffected by design — no user-facing chain references exist                                                                                                                                                                    |

**Meanwhile:** work proceeds only on chain-agnostic phases (B7 trading page,
B9-005 execution engine, B10 E2Es, design-debt follow-ups). Nothing merged
before 2026-09-17 may hard-commit the chain beyond existing config.

---

## D-109 — Agent policies: the user's limits on the agent ✅ CLOSED 2026-09-12

**Decision.** The user's control over their agent is one policy row
(`agent_policies`, unique per user; defaults when absent), with every
value clamped by schema and written only by the authenticated user via
`PATCH /api/agent/policy` (task 057):

1. **Trading policy.** `status` (active / paused), `autoTradeEnabled`
   (honored only under `AGENT_MODE=autonomous`, D-114),
   `maxStakePerTradeUsd`, `riskLevel` (prompt preset), `allowedLeagues`
   (empty = all launch leagues).
2. **Hedge policy** (`config.hedge`): `maxSizeUsd` (clamps a hedge leg),
   `maxExposureUsd` (per-market ceiling after a buy), `minConfidenceBps`,
   `cooldownMinutes` (between executed hedges), `dailyBudgetUsd` (today's
   executed hedges counted at their strategy caps), `allowedMarketTypes`.
3. **Enforcement is code.** The trade simulation blocks on status, stake,
   league and exposure; the turn context reads the autonomous flag; the
   hedge executor (`hedgePolicyGate`) holds or clamps before the daily-cap
   ledger. The agent reads its policy (`mantua_get_policy`) and has no
   tool to change it — a prompt cannot widen the limits.

**Rejected.** A chat tool that edits the policy (A-012 forbids the agent
changing its own caps; the C-010 attestation pattern is for one bounded
raise, not policy). Budget from receipts (exact but a join per tick; the
cap-bound is honest and deterministic). Columns instead of the typed
`config.hedge` block (no migration needed; zod is the contract).

**Consequence.** `agent_policies` is live. The Portfolio → Agent tab hosts
the only editor. A paused policy stops unprompted hedges and every agent
trade; the kill switch remains the platform-wide stop above it.

## D-118 — Mobile packaging: PWA first, native deferred ✅ CLOSED 2026-09-19

**Decision.** Mantua ships to phones as a Progressive Web App (task 071,
MX-007): a manifest with icons and home-screen shortcuts, a service worker
that caches the immutable build assets and the shell (never `/api/`), an
install offer that appears once earned and respects a dismissal, launch
routes (`?open=…`) that notifications and shortcuts land on, and Web Push
on the same origin. Native packaging (App Store / Play) is deferred until
app-store distribution is a growth need rather than a technical one.

**Reasoning.**

1. **Everything the phase needs, the PWA provides.** Installability,
   a full-screen shell, push notifications (Android; iOS 16.4+ once on the
   home screen), offline resilience, and a home-screen icon. Nothing in
   MX-001 … MX-009 requires a native API.
2. **One codebase, one release.** The trading flow, the ticket, the agent
   and the legal pages ship once; a native wrapper would add a second
   review pipeline, a second update cadence, and store policies for
   real-money prediction markets that are themselves an open legal
   question (L-004).
3. **Nothing is wasted later.** A native wrapper (TWA on Android, a thin
   WebView shell on iOS) wraps exactly this PWA; the manifest, the service
   worker, the launch routes and the push topics carry over unchanged.
4. **Speed is a bundle problem, not a packaging problem.** The measured
   cost on a mid-tier phone is the JavaScript on the critical path
   (`docs/design/mobile-benchmark.md`); a native shell would download the
   same bundle. The fix is lazy routes and vendor splits, done here, and
   an auth-provider decision for the remainder.

**Rejected.** React Native / a second client (duplicates the consumer
layer and every spec). Capacitor now (adds a build and a store submission
for no capability the phase needs; revisit when store presence matters).
Caching API reads in the service worker (a stale price shown as current is
worse than no price — R-005's banner is the honest offline state).

**Consequence.** `client/public/manifest.webmanifest`, `client/public/sw.js`,
`client/src/lib/register-sw.ts`, `client/src/features/pwa/`,
`client/src/lib/launch-route.ts`; the mobile browser suite runs the
production build and proves the install surface (`e2e/mobile/pwa.spec.ts`).
iOS users get the two-step "Share → Add to Home Screen" instruction in
place of the prompt, and push settings say when the home screen is the
prerequisite.

## D-107 — Social platform for agent posting ✅ CLOSED 2026-09-18

**Decision.** X (Twitter) is the platform an agent posts to (task 070,
AE-001 … AE-006). The deployment holds **one** X developer app's consumer
key/secret and **one** account's access token/secret in server env
(`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`,
`X_ACCOUNT_HANDLE`); requests are signed with OAuth 1.0a over
`node:crypto`, pinned to X's published reference vector. An agent
"connects" by claiming a public handle and enabling posting; its posts go
out through the deployment's account with the agent's display name and
its public page in the text. With any credential missing, every post is
recorded as a dry run and nothing leaves the server.

**Why one account.** Per-agent accounts need an OAuth 2.0 PKCE flow, an
encrypted token store, revocation handling and a per-account rate
budget; none of that is required to prove the analyst layer, and a single
curated account is what an audience actually follows. The record of what
each agent said is kept per agent regardless (`social_posts`), so moving
an agent to its own account later changes the sender, not the history.

**What was NOT done.** The X login shared in the task prompt (a username
and password) was not used: the API cannot be driven by a password, and a
password pasted into a task tracker is a disclosed one. It is not stored
anywhere in the repository and should be rotated by the owner.

**Rejected.** A social SDK dependency (the need is one signed POST).
Posting without a lint (every post passes `compliance.ts` first). Letting
the model write free text for a post (posts are templates over data; the
model is not in the posting path at all).

**Consequence.** `GET /api/cron/social-posts` runs every fifteen minutes
from `.github/workflows/social-posts.yml`; the operator's only work is
the four credentials and the handle. Per-agent OAuth is the recorded next
step when an agent earns its own account.

## D-117 — Launch gate definition and what closes it ✅ CLOSED 2026-09-13

**Decision.** The launch gate is one ledger (`docs/tasks/launch-gate.md`,
rows G-001 … G-018) sourced from the roadmap's Phase 9 table, its "Launch
gate" / "Public launch gate" lists, B10-010, TD-005, and the open items in
the security sign-off. Three rules govern it (task 067):

1. **Proof at the layer that was missing.** The browser suite
   (`client/e2e/`, Playwright) drives the real client in Chromium against
   the shipped API wire shapes. Authentication is a shim aliased in only
   under `VITE_E2E_AUTH=shim`; the chain is a scripted JSON-RPC mock. It
   proves the UI and its contracts, not the chain — the chain is proven by
   the Foundry fork suite in CI and by the deployment-gated live run.
2. **Guards are asserted, not reviewed.** Security headers, the
   mutating-route guard audit, and the repository secret scan are tests
   that run on every PR; a new route or file that breaks the rule fails
   CI rather than waiting for a reviewer to notice.
3. **Owner-gated rows stay visible.** Counsel review, the dogfood window,
   the mainnet deploy and its funded E2E, the M-01 written acceptance,
   and the kill-switch rehearsal are listed 🟡 with the artifact prepared
   for each; none is marked done by the code.

**Rejected.** A Playwright run against a live backend and chain in CI
(needs funded wallets and a database per run; the fork suite already
covers the chain). A content-security policy on the SPA in this task
(the auth iframe and RPC hosts need an allowlist decided with the
provider; recorded as a follow-up in the review). Bumping the
authentication SDK to clear a transitive `ws` advisory (a major behaviour
change for one moderate-impact dependency; recorded, not taken).

**Consequence.** `npm run e2e` at the root runs the browser suite;
`.github/workflows/e2e.yml` runs it on every PR; the Terms carry a
version, and a user's acceptance of that version is recorded server-side
before the first trade.

## D-116 — Portfolio valuation sources ✅ CLOSED 2026-09-12

**Decision.** Nothing in a portfolio total is hardcoded (task 066):

1. **Market positions** are marked at the live pool price (`readMarketPositions`)
   and settled at par on resolution (`settleResolvedPositions`).
2. **Assets** are priced by `usd-pricing.ts`: Pyth first, the DefiLlama
   Coins feed as fallback, then the last cached value. Phase 13 (AN-001,
   owner-gated paid plan) migrates the fallback to CoinGecko; the
   portfolio-history chart moves with it.
3. **A $0 valuation is never silent.** The lenient contract still returns
   0 when every source fails — blanking the portfolio would be worse — but
   it counts `pricing.fallback_zero`, logs the symbol, and the alert policy
   raises `pricing_zero` (warn). Cap enforcement is unaffected: it uses the
   strict helpers that fail closed (C-019).

**Rejected.** Failing reads closed (a dead feed would hide the whole
portfolio). Client-side pricing (every USD figure comes from a server
read). Switching feeds now (a Phase 13 owner decision).

## D-115 — Unified Activity model ✅ CLOSED 2026-09-12

**Decision.** The user-facing timeline is one table, `activity`, with a
typed vocabulary and one status machine (task 062):

1. **Kinds and categories.** market_buy, market_sell, redeem,
   settlement, swap, liquidity_add, liquidity_remove, send, bridge,
   deposit, withdraw, gateway_deposit, gateway_spend, hedge,
   agent_research, agent_simulation, agent_recommendation, resolution —
   grouped as trade / liquidity / transfer / agent / settlement for the
   card's icon. Agent activity is therefore self-describing (PF-020).
2. **Fields.** tx hash, chain, market / pool / related position, asset,
   raw amount, USD value, actor (user | agent | system), status, a
   one-line summary and structured data (PF-016).
3. **Status.** `pending → completed | failed`, exactly once, guarded in
   SQL; terminal rows never move (PF-017). Circle sends enter pending
   keyed by the Circle tx id and gain the hash on completion.
4. **Beside, not instead.** Every write site keeps its ledger row
   (`portfolio_transactions`, `market_fills`, `market_positions`,
   `fiat_transfers`, the audit log) and adds a best-effort activity
   entry; `(tx_hash, kind)` uniqueness absorbs replays and the webhook /
   poll race.

**Rejected.** A read-time union of the ledgers (no pending state, no
attribution, seven vocabularies). Replacing `portfolio_transactions`
now (it backs `/api/portfolio`; retire it after the portfolio reads
activity). Deriving the timeline from the audit log (attempts and
refusals are not history).

**Consequence.** `GET /api/activity` serves one feed across the user's
id, their wallet and their agent wallet. The timeline UI (lane 064)
renders `txHash` through the neutral tx row only — no chain branding
(PF-018).

## D-114 — Agent execution protocol: modes, confirmation, and the x402 exemption ✅ CLOSED 2026-09-12

**Decision.** The chat agent's money-moving tools pass one execution gate
(`server/src/lib/agent/execution-gate.ts`, task 055). The LLM proposes; the
gate decides:

1. **A server-side mode the model cannot move.** `AGENT_MODE` is
   `disabled` (503), `simulation` (previews only; every execution refused),
   `user_testing` (default — "Always Ask") or `autonomous` (unprompted
   execution only when the user's own policy row also says
   `auto_trade_enabled`; a fresh executable simulation is still the entry
   ticket).
2. **Preview → the user's words → a server-minted id → a matching call.**
   In `user_testing` a market trade must first be simulated
   (`mantua_simulate_trade`: executable status, estimate, impact, fees,
   resulting position, wallet-policy and market-policy results) and any
   other money action previewed (`mantua_preview_action`). The turn context
   is computed BEFORE the model runs: if the user's own message explicitly
   confirms (`messageConfirmsAction` — hedges, questions and negations never
   do) while a preview is pending, the server mints a single-use, 5-minute
   confirmation id and tells the model. Execution must present that id with
   the preview's tool and arguments (hash-compared); market executions are
   re-simulated immediately before running and refused on material drift
   (price > 100 bps, output shrink > 1 %, market state, fee season, any
   policy going red). One id, one execution, whatever the outcome.
3. **x402 paid data is the agent's own operating spend.** `call_paid_service`
   is NOT gated: the agent has direct marketplace access by design (owner
   directive 2026-09-12) — a "confirm" per $0.01 stats lookup would defeat
   the analyst loop. Its bounds are code: `X402_MAX_CALL_USD` per call,
   `X402_DAILY_CAP_USD` per day, from the buyer wallet, audited per call.

**Rejected.** Model-declared consent (the model deciding the user agreed —
the same reason `messageAuthorizesForce` and `messageAttestsCapRaise` are
code). Client-side confirm modals as the control (the agent path is
server-signed; the seam must be server-side — the modal is UX, lane 060).
Per-tool confirmation flags in the prompt (the prompt is advice; the gate
is the rule). Gating x402 purchases (see 3).

**Consequence.** The "acts autonomously within the cap" posture is retired
from the prompt, the route, the client copy and `docs/architecture.md`.
`trade_market` is replaced by `mantua_simulate_trade` /
`mantua_execute_trade` / `mantua_sell_position`. The user-testing minimum
flow (A-043) exists server-side; the client renders the preview and the
confirmation as chat text until lane 060 gives it a card.

## D-113 — Live-sports reliability: transport, status, trade state ✅ CLOSED 2026-09-12

**Decision.** Phase 7's user-visible reliability rests on three shapes,
chosen for the platform as deployed (one Express function on Vercel,
Hobby-plan daily crons, a client that already speaks `text/event-stream`):

1. **Server-Sent Events, not a WebSocket, for the live market stream**
   (`GET /api/stream/live`, task 051). One connection per page carries the
   slate, live pool prices and the platform status — a snapshot on connect,
   deltas on change, 5 s ticks while a game is in play, heartbeats, `id:`
   on every frame with `Last-Event-ID`, and a deliberate `end` under the
   function's 300 s ceiling. The architecture doc's WebSocket grammar
   (subscribe by id, event_type-discriminated frames, snapshot-then-deltas,
   PING/PONG) is honored over SSE. Backpressure is a per-instance
   connection cap that sheds the next client to polling with 503 +
   `Retry-After`; hidden tabs disconnect.
2. **One status, computed once, from the enforcement points' own inputs.**
   `GET /api/status` (public, 5 s cache) derives `mode` / `reads` /
   `trading` and a banner message from per-league feed freshness, games in
   play, the kill switch (deploy-time OR runtime flag, one shared reader)
   and the provider breakers, using the same thresholds the trade gate
   (P-012) and the slate label use — so the banner and the refusal never
   disagree. The client renders it globally, plus "unreachable" and
   "offline" from its own connectivity; a live platform shows nothing.
3. **Trade state is chain-verified and persisted.** A signed trade enters a
   per-wallet pending register the moment its hash exists and leaves only
   when `GET /api/markets/trade/status` (receipt-derived: confirmed /
   failed / pending / unknown) says so. "Pending" is a state with an
   explorer link, never an error; "error" is reserved for pre-chain
   failures, with wallet rejection classified as benign.

**Also decided:** the game-time ingest cadence is a 5-minute GitHub
Actions schedule hitting the read-only `/api/cron/live-sync`, and
`IN_PLAY_FEED_MAX_AGE_MS` is 15 minutes (two missed ticks with drift).

**Rejected.** A WebSocket server (no long-lived process or pub/sub on the
current deployment; revisit if the API leaves the single function). A
server-side event bus (no shared process; per-instance ticks through a
short cache are the honest shape). Provider fetches on page load to keep
the feed fresh (the 041 rule; Sportradar trial is 1 QPS). Client-trusted
trade outcomes (the server reads the chain; the client's claim is never
believed for status or for fills).

**Consequence.** The board and league pages hold one stream each and poll
only when it is not open; positions/balances join the stream after R-007
makes their reads cheap. `/api/status` is the contract the load and chaos
drills (054) assert against. The runbook's §3 "no action usually required"
now has a user-visible banner behind it.

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

_Last updated: 2026-09-12_
