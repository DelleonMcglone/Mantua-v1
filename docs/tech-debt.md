# Tech debt log

Tracks gaps and shortcuts taken under deadline pressure or due to missing
infrastructure. Each entry lists the gap, why we accepted it, and the
condition for closure.

## TD-001 — No on-chain fork test for /api/positions external-positions path

**Slice:** P4e-003 (subgraph indexing of pre-Mantua positions)

**Gap:** The external-positions enrichment path (`server/src/lib/external-positions.ts`)
issues live calls to `PositionManager.getPoolAndPositionInfo` and
`getPositionLiquidity` on Base Mainnet. The PR ships with **only** unit
coverage of the `decodePositionInfo` bit-decoder
(`server/src/lib/v4-position-info.test.ts`). The subgraph fetch, the
on-chain enrichment, and the merge with DB rows have **not** been
exercised against a live wallet, a forked node, or any integration
fixture.

**Why accepted:** No Anvil/Foundry/Hardhat harness exists in the repo. Adding
one is a multi-day undertaking that would balloon the PR. Per the
on-chain test gap policy, the bare-minimum acknowledgment is documented
here in lieu of a fork test.

**Closure condition:** Stand up an Anvil mainnet-fork harness (Foundry-
based) and add an integration test that:

1. Pins to a recent Base block where a known wallet holds at least one v4
   position opened outside Mantua.
2. Mocks the subgraph response (or seeds a local subgraph) with that
   wallet's tokenIds.
3. Calls `loadExternalPositions(wallet)` and asserts the response shape
   matches the on-chain truth (ticks, liquidity, poolKey).

**Owner:** Phase 5 owner (TBD).

---

## TD-002 — Stable Protection deployment to Base Mainnet not yet executed

**Slice:** Phase 5b-3 (Stable Protection redeploy preparation)

**Gap:** [PR #25](https://github.com/DelleonMcglone/Mantua-Intelligence/pull/25)
verified that no Mantua hook lives on Base Mainnet (8453). Stable
Protection needs to be deployed there; until then the hook address stays
`null` (env-overridable via `STABLE_PROTECTION_HOOK_ADDRESS`) and the
Stable Protection swap path degrades gracefully. The parameterized
deploy script exists, but the deploy itself has not been run: the
deployer wallet, Base ETH, and BaseScan API key are manual prerequisites
that aren't accessible from CI / Claude Code.

**Why accepted:** Foundry deploy with a real signer and live RPC is a
manual operator action by design. Automating it would require trusted
CI access to a funded Base Mainnet wallet — out of scope.

**Closure condition:** Run the deploy procedure in
[`contracts/script/README.md`](../contracts/script/README.md), capture
the deployed address, and ship the follow-up PR that:

1. Sets the `STABLE_PROTECTION_HOOK_ADDRESS` env override (and records
   it in `server/src/lib/v4-contracts.ts`).
2. Re-runs `npm run verify:hooks` so Stable Protection's row in
   `docs/security/hook-deployments.md` shows Base Mainnet (8453) ✅.
3. Updates `docs/security/sign-off.md` to mark the bytecode-verified
   column ✅ for Stable Protection on Base Mainnet.
4. Updates `contracts/README.md` hook table (add the Base Mainnet row).

**Owner:** Phase 5 owner (TBD). Blocks: any Stable Protection pool
creation on Base Mainnet.

---

## TD-003 — Agent-wallet provisioning has no integration test

**Slice:** P6-003 (Create & Manage Agent Wallet — server side).

**Gap:** `server/src/lib/agent-wallet.ts` (`getOrCreateAgentWallet`,
`getAgentWallet`) and the routes in `server/src/routes/agent-wallets.ts`
ship with **only** a unit test of the pure name-derivation helper
(`server/src/lib/agent-wallet.test.ts`). The orchestration —
look-up-user → check-existing → call-CDP → upsert → handle race — has
not been exercised against a real database, a fake CDP server, or any
end-to-end fixture. The route handlers' error branches
(`USER_NOT_FOUND`, `CDP_UNAVAILABLE`, the 500 path, the
`onConflictDoNothing` race) are likewise untested.

**Why accepted:** Same posture as TD-001 — there is no Anvil / mocked-CDP
harness in the repo. Adding a Postgres-backed test setup with a
fake CDP server would balloon this PR's diff well past the architectural
change it actually delivers. Per the on-chain test gap policy, the
bare-minimum acknowledgment is documented here in lieu of a real test.

**Closure condition:** Stand up an integration-test scaffold that:

1. Spins up an ephemeral Postgres (Drizzle migrations applied) and seeds
   a `users` row with a known `privyUserId`.
2. Stubs `setCdpClientForTesting(...)` with a fake `CdpClient` whose
   `evm.getOrCreateAccount` returns a deterministic address and asserts
   it was called with the derived `mantua-agent-${userId}` name.
3. Calls `getOrCreateAgentWallet` twice in sequence and asserts the
   second call returns the cached row without re-hitting the fake CDP.
4. Calls it concurrently and asserts the race path
   (`onConflictDoNothing` → re-read) returns the same row.
5. Drives the routes via `supertest` so the `requireAuth` /
   `walletRateLimiter` / `writeRateLimiter` chain is exercised, and
   asserts the four error code paths
   (`UNAUTHENTICATED` / `USER_NOT_FOUND` / `CDP_UNAVAILABLE` /
   `INTERNAL`).

**Owner:** Phase 6 owner (TBD). Blocks: nothing yet — the route is
behind `requireAuth` and CDP creds are `.optional()`, so the only way
to hit this code path on an un-set-up environment is a real
authenticated POST. Worth closing before P6-009 (autonomous mode)
starts driving the same paths from natural-language input.

---

## TD-004 — Agent action-card sub-flows + Phase 7 analytics view missing from the design source

**Slice:** P6-003 (Create & Manage Agent Wallet — UI side), P6-011
(Agent-level spending cap — UI side), P6-004 (Send Tokens — UI side),
P6-005 (Swap Tokens — UI side), P6-006 (Add/Remove Liquidity — UI
side), P6-007 (Query On-Chain Data — UI side), P6-008 (Portfolio
Summary — UI side + surface-placement decision), P6-009 (Autonomous
mode UI — text input + auto-execute wiring), P7-004 (analytics
result rendering — tables + lightweight-charts), P8-001 (Portfolio
landing layout), P8-003/004/005 (Balances / LP Positions / History
tabs), P8-006 (Hide Small Balances toggle UI), P8-007 (user/agent
wallet switcher), PN-006 (`<CommandBar />` on Swap/Liquidity/Agent
pages), PN-008 (preview card), PN-009 (clarification-loop UI),
PN-010 (CommandBar → confirmation modal wiring).

**Gap:** Multiple agent action-card sub-flows are missing from the
Mantua design source (`~/Downloads/mantua-ai/project/src/chat.jsx`).
The design has the action _cards_ in the chat-mode grid (line 17–22)
but no sub-flow for what happens when each is clicked — the cards just
call a host stub `window.__mantuaChatAction(a)`. Affected so far:

1. **Fund Agent Wallet flow** — the P6-003 ticket calls for an explicit
   UI where a user transfers a budget from their Privy wallet into the
   agent's CDP wallet. No design exists.
2. **Cap-management form** — P6-011 ships a server endpoint
   (`PATCH /api/agent/wallet/cap`) so a user can set their agent
   wallet's daily USD cap, but the design has no form for collecting
   that input. The current `AgentPanel.tsx` chat-mode wallet card
   sub-step _displays_ the cap (after `POST /api/agent/wallet`) but
   has no way to change it.
3. **Send Tokens flow** — P6-004 ships `POST /api/agent/send` (lookup
   agent wallet → resolve token → cap check → CDP transfer →
   BaseScan tx URL) but the chat-mode "Send Tokens" card stays inert.
   Needed: recipient input, token picker, amount input, confirmation
   step (via `useConfirmedAction`), tx-success state showing the
   BaseScan link.
4. **Swap Tokens flow** — P6-005 ships `POST /api/agent/swap`
   (lookup → cap → quote → Permit2 sign → calldata → CDP-signed send
   → record). Single server-side request with no client round-trips,
   so the UI just needs an input form + result state, not the
   2-call orchestration the user-side swap uses. Needed: tokenIn /
   tokenOut pickers, amount input, optional slippage override,
   confirmation, tx-success showing input/output amounts +
   BaseScan link.
5. **Add/Remove Liquidity flow** — P6-006 ships
   `POST /api/agent/liquidity/{add,remove}`. Add does the full
   Permit2-approve-once + sign-batch + multicall(permitBatch +
   modifyLiquidities) sequence server-side, returning `tokenId` on
   success. Remove takes a `positionId` + `percentage` and reuses
   the Phase 4 remove-liquidity calldata builder. Needed: pool
   picker, amount inputs (paired or single-side), slippage override,
   confirmation, tx-success state. The Remove flow needs a position
   list pulled from `/api/positions` filtered to the agent address.
6. **Query On-Chain Data flow** — P6-007 ships
   `GET /api/agent/query?type={pools|pool|chart}`. Needed: a query
   builder UI in the chat-mode "Query On-Chain Data" sub-step that
   maps a natural-language ask ("show me top USDC pools") to one of
   the typed queries, and a result renderer (table for pools, chart
   for historical). Phase 7 (P7-001 → P7-006) will widen this
   substantially with rich query types — likely the right home for
   the UI work, with the agent's chat card delegating to that view.
7. **Portfolio Summary surface** — P6-008 ships
   `GET /api/agent/portfolio` (balances + tx history). Two open
   questions: (a) where this lives in the chat-mode UI (the design's
   action grid uses "Fund Agent Wallet" instead of Portfolio); and
   (b) what the rendering looks like — table of balances + recent
   tx list at minimum. Likely lives as a sub-step inside the Wallet
   card (P6-003), or as a route off the main app shell. Both are
   waiting on a design.
8. **Autonomous mode chat UI** — P6-009 ships the server endpoint
   (`POST /api/agent/instruction`, NLP parser → structured intent)
   but the chat UI is deferred. Needed: a text input in the
   `step === 'auto'` body of `AgentPanel.tsx`; on submit, call
   `POST /api/agent/instruction`; render the result (parsed action
   summary, clarification question, or rejection reason); wire an
   "execute" affordance on a parsed action to the matching action
   endpoint (P6-003 → P6-008). The current autonomous-step body is
   the "Autonomous mode is wiring up" placeholder, untouched since
   the design port.
9. **Phase 7 analytics view** — P7-003 ships
   `GET /api/analytics?type=...` (six query types: pools, pool,
   chart, protocol, dex_volume, token_price) but P7-004 (result
   rendering) is deferred. Needed: a route in the main app shell
   (likely `/analyze` based on existing client folder structure)
   with table renderers for tabular responses (pool list, dex
   volume protocol breakdown, token-price grids) and
   `lightweight-charts` for the time-series responses (pool TVL +
   APY history; protocol TVL history). The chat-mode "Query
   On-Chain Data" card (P6-007) can deep-link into this view once
   it lands.
10. **Phase 8 portfolio page** — `GET /api/portfolio` (P8-003) and
    `PATCH /api/preferences` (P8-006) ship the data layer; the UI is
    deferred. Needed: a portfolio landing route under
    `client/src/features/portfolio/` per the v2 design source — tabs
    for **Balances** (one row per supported token, USD value, swap
    shortcut), **LP Positions** (driven by `GET /api/positions`,
    hook badges via address-to-name mapping), **History** (Swap /
    Pool / Deposits filtered from the `transactions` array client-
    side, BaseScan link per row); a **Hide Small Balances** toggle
    that PATCHes `/api/preferences` and re-renders the Balances list
    filtered to balances ≥ $1; a **user/agent wallet switcher**
    that flips the data source between `GET /api/portfolio` and
    `GET /api/agent/portfolio` (both return identical shapes). The
    P6-008 portfolio surface-placement question (item 7 above) is
    a subset of this — once P8-001 lands, the agent's chat-mode
    portfolio sub-step can deep-link into the same view in agent
    mode.
11. **Phase N command bar** — `POST /api/command/parse` (PN-003)
    - the Zod intent schema (PN-002) ship the data layer; the UI is
      deferred. Needed: a `<CommandBar />` component (PN-006) per the
      Mantua design prototype that appears on Swap, Liquidity, and
      Agent pages — text input + submit calls
      `POST /api/command/parse` with the current page context (`page`,
      `poolId`, `tokenInFocus`, `note`) populated. After the parser
      returns, render a **preview card** (PN-008) showing the parsed
      intent in human-readable form before any execution. For
      `clarification_needed` intents, run a **clarification loop**
      (PN-009) — show the LLM's question, capture the user's reply,
      re-parse with the appended context. For action intents, wire
      through the existing `useConfirmedAction` seam (P1-005) to the
      matching action endpoint (PN-010). The server side already
      enforces "never auto-execute": the parse route returns the
      intent and stops there; execution requires a separate POST.

The codebase rule that "UI is design-driven; feature tickets never
motivate UI edits" (memory feedback) means the engineering side cannot
invent any of these flows.

**Why accepted:** Surfaced when scoping P6-003 (Fund), again when
scoping P6-011 (cap form), and again when scoping P6-004 (Send). The
user signed off on splitting each ticket: server-side ships now, UI
waits for the design source. The chat-mode wallet card is wired to
`POST /api/agent/wallet` and shows the resulting address + cap inline,
but the Fund / Send action cards stay inert and the cap stays at
whatever value was set via API (default $100, or whatever a manual
`PATCH` set it to).

**Closure condition:**

1. Mantua design source adds:
   - A Fund-flow modal/sub-step (input amount, chosen token,
     source-wallet preview, confirmation, success).
   - A cap-edit field or modal (number input, validate against
     `HARD_DAILY_CAP_USD = $50k`, optimistic UI, error toast on 400).
   - A Send-flow modal/sub-step (recipient address input, token
     picker, amount input, confirmation, tx-success with BaseScan
     link).
2. Port the designs into `client/src/features/agent/` following the
   existing `chat.jsx` → `AgentPanel.tsx` port style.
3. Wire the flows:
   - Fund — Privy-signed ERC-20 / ETH send to the agent address from
     `GET /api/agent/wallet`. Through `useConfirmedAction` (P1-005).
   - Cap — `PATCH /api/agent/wallet/cap`.
   - Send — `POST /api/agent/send` with `{ to, amount, token }`.
     Through `useConfirmedAction`. Show `result.explorerUrl` on
     success.
4. Flip P6-003 / P6-004 from 🟡 → ✅ in `docs/tasks/v2-roadmap.md`.
   P6-011 stays ✅ — its server-side deliverable is complete already;
   the UI half is bundled into this TD's closure for review continuity.

**Owner:** Phase 6 / Design owner (TBD). Blocks: P6-003 / P6-004
cannot be marked fully shipped; agent users have no in-app way to
fund their wallet, change the agent's cap from the schema default,
or send tokens (they can still call any of the endpoints via cURL
with their Privy access token).

---

## TD-005 — Phase 6 + Phase 7 + Phase N E2E test harness does not exist

**Slice:** P6-012 (E2E: 6 chat-mode actions + 5 autonomous-mode
instruction types), P7-006 (10 representative analytics queries),
PN-011 (25 prompt variations per intent type for the command bar).

**Gap:** P6-003 → P6-010 each ship server-side without integration
tests against the real surfaces they call (a real DB, real CDP,
real Uniswap Trading API, real Anthropic API, real RPC). TD-003
captures the orchestration test gap for one ticket scope; P6-012
asks for the full E2E:

1. The 6 chat-mode actions (Wallet / Send / Swap / Liquidity-add /
   Liquidity-remove / Query / Portfolio — note this is 7 endpoints
   collapsing the wallet "Fund" and "Create" into one card per the
   design source) drive `POST/GET /api/agent/wallet`,
   `POST /api/agent/send`, `POST /api/agent/swap`,
   `POST /api/agent/liquidity/{add,remove}`, `GET /api/agent/query`,
   `GET /api/agent/portfolio`.
2. Five representative autonomous-mode instruction types drive
   `POST /api/agent/instruction` and assert the parsed intent kind
   matches expectations (e.g. _"swap 10 USDC for ETH"_ → `swap`;
   _"send 1 USDC to 0xabc..."_ → `send`; _"add liquidity to USDC/EURC
   0.05% with 100 USDC and 100 EURC"_ → `add_liquidity`; _"what's
   my agent balance"_ → `query`/`wallet`; _"buy a horse"_ →
   `reject`).
3. **Phase 7 analytics — 10 representative queries** (P7-006) drive
   `GET /api/analytics?type=...`: list pools (Base), single pool by
   id, chart for a known pool (30-day), two protocol-by-slug lookups
   (e.g. `uniswap`, `aave-v3`), two chain dex_volume lookups (e.g.
   `base`, `ethereum`), three token_price queries with mixed key
   shapes (`coingecko:ethereum`, `base:0x833589...`, batch of 5).
   Asserts response shape, status codes for missing slugs (404), and
   that repeat queries within 60s hit the cache (no upstream call).

**Why accepted:** Two structural blockers stand between us and a real
E2E run: (a) the deferred UIs in TD-004 — the chat-mode action cards
and autonomous-mode input are inert, so there's no driver for E2E
yet; and (b) a funded test agent wallet with stable signer setup
needs to exist for the on-chain assertions to be repeatable.
Per the on-chain test gap policy, the bare-minimum acknowledgment is
documented here in lieu of a real test.

**Closure condition:**

1. TD-004 closes (UIs land); TD-003 closes (per-ticket integration
   harness exists).
2. Stand up an E2E scaffold that:
   a. Provisions a fresh test agent wallet (Base Mainnet or an Anvil
   fork of it) and funds it with a small, dedicated USDC + ETH budget.
   b. Drives the chat-mode UI through Playwright (or equivalent),
   executing each of the 6 cards end-to-end and asserting the
   resulting BaseScan tx confirms.
   c. Drives the autonomous-mode UI with the 5 representative
   instructions, asserts the parsed intent shape, and (where
   executable) that the action also lands on-chain.
3. Document residual flakiness sources (Trading API rate limits,
   CoinGecko outages, Anthropic API hiccups) and run the suite in CI
   on a nightly cadence with auto-retry on infrastructure failures.
4. Flip P6-012 🟡 → ✅ once green for 7 consecutive nightly runs.

**Owner:** Phase 6 / QA owner (TBD). Blocks: launch readiness
checklist (Phase 9) which expects every Phase 6 ticket green.

---

## TD-006 — OpenAI fallback for the LLM provider abstraction

**Slice:** PN-001 (LLM provider abstraction with Anthropic primary +
OpenAI fallback).

**Gap:** PN-001's spec calls for a fallback to OpenAI GPT (4.1 / 5)
when the Anthropic API returns an availability error. The Anthropic
primary path is shipping (`server/src/lib/command-bar-nlp.ts` for the
command bar, `server/src/lib/agent-nlp.ts` for the agent mode); the
fallback shape is **not** wired. Today, an Anthropic 5xx /
rate-limit / overload propagates through the existing route as 502
`UPSTREAM_FAILURE`.

**Why accepted:** The fallback adds the `openai` SDK as a server
dependency (real install, real transitive deps) plus the fallback
control flow itself (which Anthropic error classes trigger
fallback — `RateLimitError`? `InternalServerError`? both? — and how
to time-box the retry). Shipping the Anthropic primary first lets us
get the parser into beta and observe real failure rates before
deciding fallback policy. The architecture-doc decision D-013
(Anthropic primary, OpenAI fallback) remains accepted; this TD just
tracks the fallback half.

**Closure condition:**

1. `npm install --workspace=@mantua/server openai`
2. Add `OPENAI_API_KEY` to env.ts (already optional there).
3. Define a small `LlmProvider` interface in
   `server/src/lib/llm-provider.ts` with both implementations
   (Anthropic primary, OpenAI fallback). Keep the existing
   `parseCommand` / `parseInstruction` shape; only the internal
   call-Claude-or-fall-back-to-OpenAI logic changes.
4. Decide which Anthropic error classes trigger fallback. Default:
   `Anthropic.InternalServerError` (5xx) and `Anthropic.APIError`
   when `status >= 500` AND not a `BadRequestError` (400s are
   parse-side bugs, not availability errors — don't fall back).
   Explicitly **not** `RateLimitError` (429): retry with backoff
   on the same provider rather than spending OpenAI tokens to work
   around a temporary rate limit. Document the policy in
   `docs/architecture.md`.
5. Map OpenAI's tool-use shape (function calling) to the same
   `Intent` shape produced by Anthropic's tool-use blocks. The
   tool definitions can be shared structurally; only the wire
   format differs.
6. Test path: install a fake `LlmProvider` whose Anthropic side
   throws `InternalServerError` and whose OpenAI side returns a
   stubbed intent. Assert the parser falls back without surfacing
   the Anthropic error to the route. Optionally run one live
   smoke-test against both providers as a CI job.
7. Flip PN-001 🟡 → ✅. Add a note pointing back at this TD's
   closure SHA.

**Owner:** Phase N owner (TBD). Blocks: PN-001 cannot flip to ✅;
beta dogfood may experience hard parse failures during Anthropic
outages where the fallback would have kept the command bar working.
