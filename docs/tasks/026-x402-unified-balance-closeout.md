# 026 — x402 + unified-balance closeout (C-007, C-008)

**Status:** ✅ done 2026-09-04 · **Branch:** `026-x402-unified-balance-closeout`

Closes the two remaining Phase-1 rows from the circle-custody wave ledger
(`docs/tasks/circle-custody-wave.md`): C-007 (x402 payments, scope per D-106)
and C-008 (unified USDC balance service).

---

## C-007 — x402 per D-106: reconciliation

D-106 (`docs/decisions/v2-open-decisions.md`) is x402's scope source of truth,
not the ledger row. Reconciling what it locked against this branch:

**What "integrated" means.** The two shipped, env-gated-off-by-default
surfaces ARE the integrated scope:

- **Buyer** — `server/src/lib/x402-buyer.ts` (HTTP-native x402 v2; Bazaar
  discovery; EIP-3009 payment via the buyer EOA; `X402_MAX_CALL_USD` /
  `X402_DAILY_CAP_USD` rails; one `agent_x402` audit row per payment),
  surfaced as the `search_paid_services` / `call_paid_service` chat tools.
- **Seller** — `server/src/routes/x402-service.ts`
  (`GET /api/x402/analyst-brief`, $0.01 USDC, payment-is-the-auth, 503
  `X402_SELLER_DISABLED` when `X402_SELLER_ADDRESS` is unset).

**What is reserved.** Everything beyond those two surfaces — additional paid
endpoints, new buyer integrations, key/settlement/facilitator changes,
flipping x402 default-on, the Bazaar listing question, the D-012 seller-revenue
posture, and production cap defaults — is **forward scope awaiting owner
review** per D-106's ⬜ open questions. **This branch builds none of it.**

**The build gate.** D-106's lock was "no x402 build starts before the C-wave
hardening lands." The C-wave hardening has landed (C-015/17/19/20/21 merged on
`main`), so the gate is satisfied; the remaining build work D-106 itself
identified for the shipped surfaces was their missing tests. That is what this
branch ships:

### Tests added (D-106's "no tests" gap)

- `server/src/lib/x402-buyer.test.ts` — 16 tests:
  - per-call ceiling rejects a price above `X402_MAX_CALL_USD` **before** the
    daily-cap query runs, and passes a price exactly at the ceiling;
  - daily cap is summed from `agent_x402` audit rows (malformed rows
    ignored), rejects when spend + price crosses `X402_DAILY_CAP_USD`, and
    allows a call landing exactly on the cap — with no payment attempt and no
    audit row on a blocked call;
  - disabled (`X402_ENABLED=0`) and keyless modes refuse with `X402Error`
    and **zero network traffic** (the chat layer then serves free data), and
    a free (non-paywalled) endpoint returns its body with `usdCost: 0` and
    no audit row;
  - exactly one audit row per payment: the success row carries
    `{url, method, chain, usdCost}` and the lowercased buyer address; a
    post-payment HTTP failure writes a failure row
    (`http_500_after_payment`) and flags `mayHaveCharged`;
  - balance pre-flight: an underfunded rail produces the "Nothing was
    charged" error before signing; an RPC failure fails open.
- `server/src/routes/x402-service.test.ts` — 3 tests over a real express
  server on an ephemeral port: 503 `X402_SELLER_DISABLED` with no facilitator
  traffic when unset; a wired paywall answering an unpaid request with 402 +
  a `PAYMENT-REQUIRED` header (`exact` / `eip155:8453` / `payTo` = seller /
  `$0.01` = 10000 atomic) when set; unrelated paths untouched.

Mock style follows the repo's seam-free `node:test` approach: no source edits
were needed — `globalThis.fetch` is swapped (covering both the x402 pre-flight
and viem's RPC transport), the parsed `env` object is mutated per test, the
drizzle `db` facade's `select`/`insert` entry points are shadowed with
recording fakes, and the seller router's two env states are loaded as fresh
module instances via query-string imports. The facilitator `/supported`
handshake is answered locally, so the suites are hermetic.

---

## C-008 — unified USDC balance service: verification trace + verdict

Claim under test: *"Unified USDC balance service: consolidated balance across
supported chains (feeds Portfolio §6)"* — ledger row filed 🟡 stale-as-filed
("exists, agent-side … no user-facing surface, no tests").

**Trace (route → hook → tab), verified in this tree:**

1. **Service** — `server/src/lib/unified-balance.ts` `getUnifiedBalances()`
   aggregates the agent wallet's USDC across chains via the Unified Balance
   Kit (`kit.getBalances`), returning `{provisioned, address, totalUsdc,
   breakdown: [{chain, amount}]}`.
2. **Route** — `server/src/routes/agent-unified-balance.ts`
   `GET /api/agent/unified-balance` (auth-gated; mounted in
   `server/src/app.ts:89`), with graceful 503
   `UNIFIED_BALANCE_UNAVAILABLE` / 502 `UPSTREAM_FAILURE` degradation.
3. **Hook** — `client/src/features/portfolio/use-unified-balance.ts` fetches
   the route on mount/auth-change and exposes `{data, loading, error}` plus
   the deposit action.
4. **Portfolio surface** — `client/src/features/portfolio/AssetsCard.tsx:118`
   calls `useUnifiedBalance()` **once** and (a) derives the "Unified Balance"
   tab count as the number of chains holding a non-zero share
   (`AssetsCard.tsx:190`), (b) passes the same `ub` object into
   `UnifiedBalanceTab` (`AssetsCard.tsx:422`) so tab count and body share one
   request. `AssetsCard` renders in the Portfolio left column
   (`client/src/App.tsx:375`, profile/positions/asset/pool routes).
5. **Tab** — `client/src/features/portfolio/UnifiedBalanceTab.tsx` shows the
   consolidated `totalUsdc`, the per-chain breakdown, and the deposit flow.

**Chainless check.** The tab's chain names appear only in the breakdown rows
(where the money can be spent to / currently sits) — destination info, which
the chainless carve-outs allow; product copy elsewhere stays chain-free and
the deposit receipt suppresses the raw tx hash behind a "Deposit confirmed ↗"
link (per the receipt-style convention in `docs/architecture.md` §UX).

**Verdict: C-008 holds end-to-end.** The consolidated cross-chain balance
reaches the Portfolio surface; the ledger row's "no user-facing surface"
residual is itself stale — `UnifiedBalanceTab` closed it. Scope remains
agent-wallet (treasury), not the user's Privy wallet, matching the ledger's
"agent-side" qualifier.

### Tests added (read path)

- `server/src/lib/unified-balance.test.ts` — 6 tests over the module's pure,
  exported helpers (the vocabulary the spend read-path validates against):
  `GATEWAY_SPEND_CHAINS` (five mainnet destinations, Base excluded),
  `isGatewaySpendChain` strictness, and `resolveGatewaySpendChain` fuzzy
  matching (aliases/tickers, separator + mainnet/one suffix stripping, null —
  never a guess — for non-destinations including Base).

---

## Findings (not fixed here — ownership boundaries)

1. **Breakdown shaping is not unit-testable without a seam.** The
   `res.breakdown` → `[{chain, amount}]` flattening in `getUnifiedBalances`
   (`unified-balance.ts:179-184`) is inline and unexported, so the read-path
   tests cover the exported helpers only. The file's owner could extract a
   pure `shapeBreakdown(accounts)` helper to make it testable.
2. **Daily x402 spend can undercount after ambiguous failures.**
   `getTodayX402Spend` sums `usdCost` from `agent_x402` rows, but the
   failure rows written after a payment was sent
   (`http_NNN_after_payment`) carry no `usdCost` — a charged-but-failed call
   does not count against `X402_DAILY_CAP_USD`. Conservative would be to
   record the attempted price on those rows. (x402-buyer.ts source is
   test-only territory for this branch; flagged for the D-106 owner review.)
3. **Ledger row staleness (for the wave ledger's owner):** C-008's residual
   "no user-facing surface, no tests" no longer matches the tree — the
   Portfolio tab exists and the read-path/pure-helper tests now exist;
   D-106's "no tests" note on the x402 surfaces is likewise closed by this
   branch.
4. **Minor, display-level:** `use-unified-balance.ts` duplicates the fetch
   logic between the mount effect and `refetch` (deliberate per its comments,
   to keep setState out of the effect body); left as-is.
