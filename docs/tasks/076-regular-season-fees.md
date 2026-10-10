# Task 076 — Dynamic fee in every season (D-105 amendment)

> Owner directive 2026-10-10: Mantua charges users. The fee structure that
> was going to start in the playoffs starts in the regular season too.
> Decision record: **D-105 amendment (2026-10-10)** in
> `docs/decisions/v2-open-decisions.md`.

**Branch:** `claude/dazzling-rubin-yd4i7i` (the session's designated branch; the
task number is carried here and in the decision record rather than in the
branch name).
**Prompt history:** `docs/promptHistory/2026-10-10-regular-season-fees.md`

## Task description

D-105 (task 049) made the Dynamic Market Hook's fee season-gated: a pool
registered as a regular-season game returned `REGULAR_SEASON_FEE = 0`
before any driver was read, and only a playoff pool paid the dynamic
0.10%–0.70% rate. The owner has withdrawn the 0% regular season. The same
fee structure — `Fee = C × rate × p × (1 − p)`, rate in
`[MIN_RATE, MAX_RATE]` from liquidity, volatility, activity and
uncertainty, 0.70% immutable ceiling, stale keeper clamps to the ceiling —
now applies to every pool regardless of season.

Nothing else about the fee model changes: no new rate, no new band, no
new driver. The change is the removal of one gate and of the constant it
returned, plus every mirror, label, test and document that described the
regular season as free.

## What stays

- The per-pool `playoffs` flag in `MarketState`, `PoolRegistered`,
  `Breakdown` and the fee telemetry. It is still a registration fact from
  the league calendar and still write-once; it is now a season **label**
  for telemetry and the UI, not a fee gate. Removing it would change the
  registry ABI, the hook's event and quote shapes, the DB telemetry column
  and every consumer for no fee-model benefit.
- `MIN_RATE`, `MAX_RATE`, the four drivers and their shares, `clampRate`,
  the stale clamp, the trade cap.

## Success criteria

- `MarketFeeCalculator.rate` reads the drivers for every pool; the
  breakdown for a regular-season pool is identical to a playoff pool under
  the same conditions except for the `playoffs` label.
- `RiskPolicy.REGULAR_SEASON_FEE` no longer exists; nothing references it.
- A regular-season pool with a stale keeper pays `MAX_RATE × (1 − p)`.
- The TypeScript mirror (`server/src/lib/sports/market-fee.ts`) carries no
  regular-season constant; the combo planned fee uses the hook's floor
  rate in every season.
- User-facing copy (ticket, combo review, fee explainer, docs page,
  Terms, support knowledge, `docs/fee-model.md`, README) says the dynamic
  fee applies in every season.
- Contract, server and client test suites pass; the invariant suite's
  "regular season is free" property is replaced by "season does not change
  the rate".

## Failure conditions

- Any path that still returns a zero rate because `playoffs == false`.
- A regular-season fee quote that differs from the playoff quote for the
  same pool conditions.
- Copy anywhere that still promises a free regular season.

## Edge cases

- **Stale keeper, regular season** — previously 0; now the ceiling, the
  same fail-closed posture as the playoffs.
- **Unknown season type** — still maps to `playoffs = false` (the label
  default); it no longer has a fee consequence.
- **`p = 1`** — the pip fee is still 0 by the formula, so a `$0.00 /
0.00%` fee line can still render; the ticket keeps rendering all four
  lines.
- **Live deployment** — the hook on Arc Mainnet (2026-09-30) carries the
  old gate in its bytecode. This task changes the source; the deployment
  runbook records that charging regular-season pools needs a redeploy and
  re-registration of open regular-season pools.

## Implementation checklist

- [x] `RiskPolicy.sol`: drop `REGULAR_SEASON_FEE`; update the comments on
      `clampRate` and the file header.
- [x] `MarketFeeCalculator.sol`: drop the season gate; update the header.
- [x] `MarketFeeFormula.sol`, `IMarketStateRegistry.sol`,
      `MarketStateRegistry.sol`, `DynamicMarketHook.sol`: comments.
- [x] Contract tests: `RiskPolicy.t.sol`, `MarketFeeFormula.t.sol`,
      `MarketFeeCalculator.t.sol`, `DynamicMarketInvariant.t.sol`,
      `FeeScenarios.t.sol`, `DynamicMarketHook.t.sol`.
- [x] Server: `market-fee.ts` (constant), `combo-pricing.ts` /
      `combo-trade.ts` (planned fee in every season), `ingest.ts`,
      `espn.ts`, `combo-season.ts` comments, `support/knowledge.ts` copy;
      tests updated.
- [x] Client: `TicketReview.tsx`, `ComboReview.tsx`, `FeeExplainer.tsx`,
      `docs-content.tsx`, `TermsProductSections.tsx`, `ActivityTab.tsx`,
      `agent-cards.ts`, `fee-lines.ts` comment; unit and e2e expectations.
- [x] Docs: `docs/fee-model.md`, `README.md`, `docs/architecture.md`,
      `docs/specs/dynamic-market-hook.md` (§0.6 amendment), decision
      record, Terms draft, `deploy/dynamic-market/README.md`.
- [x] `forge test`, server tests, client tests, lint, typecheck, format.

## Deployment (owner directive 2026-10-10: "deploy a new hook")

- [x] `contracts/script/DeployDynamicMarketHook.s.sol` — hook-only deploy
      against the live PoolManager and registry; refuses an address with
      no code; asserts the mined address, bits and wiring in the deploy tx.
- [x] `deploy/dynamic-market/deploy.sh hook-only` — same preflight, dry run
      and `yes` gate as the stack deploy; post-deploy checklist printed.
- [x] Runbook section "Redeploying the hook alone"; rehearsed on a local
      anvil (chain id 5042, CREATE2 proxy etched): stack deploy, then
      hook-only against it, probes and the bad-address guard.
- [ ] **Arc Mainnet broadcast — needs the `mantua-deployer` keystore and
      RPC egress, neither of which this cloud session has.** Run
      `deploy/dynamic-market/deploy.sh hook-only` from the machine that
      holds the keystore (the exports are in the runbook).
- [ ] Record the new address and salt in the deployment record; update
      `DYNAMIC_MARKET_BY_CHAIN[ARC_CHAIN_ID].hook` and its test; run
      `npm run verify:hooks`; run the `quoteFee` probe on the first new
      market; security pass and sign-off for the new address.
