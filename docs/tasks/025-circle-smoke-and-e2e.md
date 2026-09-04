# 025 — Circle smoke + E2E test coverage (C-012, C-013, C-014)

**Status:** ✅ code complete 2026-09-04 · **Branch:** `025-circle-smoke-and-e2e`

Closes the three Phase-1 Circle test-coverage tasks. Two of the four layers
run today; the other two are credential-gated and armed to run the moment the
pending Circle-side entity-secret reset lands (see
`docs/tasks/018-circle-credentials.md`).

| Layer | Task | Needs | Ran now? |
| --- | --- | --- | --- |
| Offline chain-identifier smoke | C-014 | nothing | ✅ yes — all identifiers found |
| Sponsorship / execute failure-mode units | C-012 | nothing (mocked client) | ✅ yes — green in `npm test` |
| Live identifier round-trip | C-014 | `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` | ⏸ awaits credentials (auto-runs inside `circle:id-smoke` once set) |
| Testnet E2E flow | C-013 | `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` (+ `CIRCLE_WALLET_SET_ID`, `DATABASE_URL`) | ⏸ awaits credentials — prints SKIPPED and exits 0 today |

## C-014 — chain-identifier smoke (`npm run circle:id-smoke -w @mantua/server`)

`server/src/scripts/circle-id-smoke.ts`. Chain ids are stringly-typed at
every Circle boundary and each SDK family spells them differently (DCW
`"BASE"`, kits `"Base"`), so an SDK upgrade could silently orphan a name the
app passes as a plain string.

- **Offline layer (always runs, no network):** validates every identifier the
  app assumes against the *installed* SDKs in `node_modules/@circle-fin/*`:
  - DCW `Blockchain` contains `"BASE"` — re-asserted **at compile time**
    (a typed `const` the typecheck gate enforces) *and* against the runtime
    enum. This programmatically re-asserts the earlier audit finding.
  - Every name `lib/agent-bridge.ts` passes to Bridge Kit (`Base`,
    `Ethereum`, `Arbitrum`, `Avalanche`, `Optimism`, `Polygon`) exists in the
    kit's `BridgeChain` enum (the CCTPv2-bridgeable subset — membership in
    the broader `Blockchain` enum alone would not prove bridgeability).
  - Every name `lib/unified-balance.ts` passes to Unified Balance Kit exists
    in `UnifiedBalanceChain`.
  - The app-side lists are **extracted from the source files** (regex over
    `HOME_CHAIN` / `AGENT_BRIDGE_DESTINATIONS` / `GATEWAY_SPEND_CHAINS`), so
    the smoke cannot drift from what the code actually sends; extraction
    failure is itself a failure.
  - Reports each id → found / NOT FOUND; exits 1 on any miss.
- **Live layer (only when `CIRCLE_API_KEY` is set, and skipped with a note
  when the entity secret is absent):** one `listWallets` call asserting a
  BASE-family blockchain value (`BASE` / `BASE-SEPOLIA`) round-trips through
  the real API. Secrets are never printed — key shape only, matching
  `circle-preflight.ts`.

Offline run on this branch: **13/13 identifiers found**, live layer skipped
(no credentials), exit 0.

## C-012 — sponsorship failure-mode units

Extended `server/src/lib/circle/sponsorship.test.ts` and
`server/src/lib/circle/execute.test.ts`, mocking the Circle client via the
existing `setCircleClientForTesting` seam (same style as the pre-existing
tests). New coverage:

- **Unsponsored-in-production refusal** now also asserts the SDK is *never
  invoked* (guard, not API error), covers the ABI arm, and holds under a
  10-wide concurrent burst (every create rejects with
  `SponsorshipNotConfiguredError`, zero SDK calls).
- **Sponsorship ref propagation** through the full `executeAgentCalldata`
  path (create → receipt poll): the SDK input carries
  `refId: gas-station:<policy-id>` and the call resolves only on the
  confirmed receipt.
- **Terminal failures surface as failures, never successes:** `DENIED`
  (compliance denial, with `errorReason`) via both the full sponsored path
  and `pollReceipt`; `FAILED` with a txHash present (a revert has a hash —
  the hash proves broadcast, not outcome). `CANCELLED` was already covered.
- **Timeout → typed indeterminate outcome:** a bounded poll ending without a
  terminal state raises `CircleReceiptTimeoutError` (distinct from
  `CircleTransactionFailedError`), carrying `circleTxId`, `timeoutMs`, the
  last observed hash (or null pre-SENT), and the "outcome pending, not
  success" message.
- **High-volume concurrency:** a 25-wide concurrent `createAgentContractExecution`
  burst — every input carries the sponsorship ref, all idempotency keys are
  distinct, and every wallet id arrives unmangled (no shared-state bleed).

## C-013 — E2E harness (`npm run circle:e2e -w @mantua/server`)

`server/src/scripts/circle-e2e.ts`, credential-gated:

- **Without credentials** (today's state): prints `Status: SKIPPED`, lists
  exactly which variables are missing, executes nothing, exits 0 — safe in CI
  and ready the moment the entity-secret reset lands.
- **With `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET`:** runs the real flow
  against Circle testnet:
  1. Refuses a LIVE key unless `CIRCLE_E2E_ALLOW_MAINNET=1` (the harness
     targets testnet; TEST key → `BASE-SEPOLIA`).
  2. Provisions (or reuses) an SCA agent wallet in the configured wallet set
     via the production `getCircleClient` / `getAgentWalletSetId` path.
  3. Executes one tiny sponsored no-op — USDC `transfer(self, 0)` — through
     the production `executeAgentAbiCall` path (allowlist choke point →
     sponsorship guard/refId → idempotency-keyed create → poll to terminal).
     Testnet USDC joins the allowlist via the sanctioned
     `registerDynamicTargets` hook, never by bypassing the check. Timeout is
     reported as INDETERMINATE (typed), terminal failure with its state and
     `errorReason` — both exit 1.
  4. Mirrors the agent-send finalization writes (`recordSpending` at $0 +
     `logAudit` `agent_send`/`success`) and verifies via SELECT that a
     `mantua_audit_log` row exists for the txHash and a `daily_wallet_spend`
     row exists for the wallet today. With no `DATABASE_URL` this step is
     skipped gracefully with a note (circle-preflight's report-don't-crash
     approach); env.ts's required vars get inert stubs so the gate — not the
     env parser — decides what runs.
- No secret is ever printed (key shape only).

## Gates

`npm run typecheck`, `npm run lint`, stub-env `npm test -w @mantua/server`
all green on this branch; `npm run circle:id-smoke -w @mantua/server`
(offline layer) passes.
