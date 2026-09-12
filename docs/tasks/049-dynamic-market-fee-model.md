# Task 049 — Dynamic Market Hook fee model (Phase 5, H-001 … H-017)

> Owner directive 2026-09-11 (Phase 5 🪝, 🔴). Adjust the Dynamic Market
> Hook to Mantua's fee model and formula, prove it with unit / property /
> fuzz / scenario tests, run the AI-assisted security pass, prepare the Base
> Mainnet deploy, and wire the fee through pool creation, telemetry, the
> pre-trade quote, and the UI. Decision record: **D-105** in
> `docs/decisions/v2-open-decisions.md`.

## Task description

The hook shipped under B2 charged a 0.30%–5.00% "five-premium" fee band on
every swap. Mantua's fee model (spec, authoritative) is different in kind:

- **Regular season: 0% trading fees.**
- **Playoffs: dynamic fees**, rate in **0.10%–0.70%**, driven by liquidity,
  volatility, trading activity, and market uncertainty.
- **Ceiling 0.70%** — immutable, no admin path; lifting it needs a redeploy.
- **Formula:** `Fee = C × fee_rate × p × (1 − p)`, where `C` is the number
  of contracts traded, `fee_rate` the dynamic rate, `p` the contract price
  (implied probability) read from the pool. `p × (1 − p)` peaks at
  `p = 0.50`, so 50/50 trades pay the most per contract and the fee falls
  toward 0 at `p → 0` and `p → 1`.

### How the formula maps onto a Uniswap v4 fee

v4 charges the LP fee as a fraction (`pips`, 1e6 = 100%) of the swap's
**gross input**. Define `C` as the contract-equivalent of that gross input
at the pre-trade price `p`: for a YES input `C` is the token amount, for a
USDC input `C = input / p`. Then in every direction and for exact-in and
exact-out alike, `Fee = C × r × p × (1 − p)` holds **exactly** when the hook
returns

```
feePips = r × (1 − p)
```

(USDC in: `fee = feePips × X = r(1−p) × C p = C r p (1−p)`; YES in: fee is
`r(1−p) × C` YES tokens worth `p` each, again `C r p (1−p)`.) The per-contract
fee `r × p × (1 − p)` is what peaks at 0.50; the pip rate on the input is
the formula divided by the contract's value. `MarketFeeFormula.sol` owns this
derivation; `server/src/lib/sports/market-fee.ts` mirrors it bit-for-bit.

## Success criteria

- [x] `MIN_RATE = 1_000` (0.10%), `MAX_RATE = 7_000` (0.70%),
      `REGULAR_SEASON_FEE = 0` are `constant`s in `RiskPolicy`; no setter,
      no storage, no path from keeper/operator/hook to change them (H-002).
- [x] `feePips = rate × (BPS − p) / BPS` exactly (integer, floor); the
      per-contract fee `C × r × p × (1 − p)` is exposed as a pure function
      and both are covered by shared test vectors (H-001, H-005).
- [x] The rate is `MIN_RATE + Σ premiums`, four drivers (liquidity,
      volatility, activity, uncertainty) whose weights sum to 100% of the
      headroom, clamped into `[MIN_RATE, MAX_RATE]`; stale keeper state
      fails closed to `MAX_RATE` (H-003).
- [x] Season switch: each pool is registered with a `playoffs` flag taken
      from the league calendar (Sportradar `PST` / ESPN season type 3).
      Regular season → fee 0 on every swap regardless of conditions;
      playoffs → dynamic. The flag is set once at registration (H-004).
- [x] `p` is read from `sqrtPriceX96` (pool state) before the swap, in both
      token orderings (H-005).
- [x] Unit + property tests: fee ≤ ceiling always; fee = 0 in regular
      season; `fee(p=0.5) ≥ fee(p)` for fixed conditions; monotone toward
      0 and 1; rate reaches exactly `MIN_RATE` (calm) and `MAX_RATE`
      (all drivers at max) (H-006, H-015).
- [x] Fuzz + invariant harnesses, 100k-call sweep (H-007).
- [x] Rounding / overflow tests: floor error < 1 pip, no revert at the
      extremes of every input (H-016).
- [x] Manipulation-resistance tests: bounded influence of each gameable
      input; manipulation legs pay fees; flow decays (H-017).
- [x] Live scenario matrix across p = 0.05/0.25/0.50/0.75/0.95 and
      calm / thin / volatile / one-sided / stale conditions (H-013).
- [x] Security pass documented in `docs/security/dynamic-market-fee-review.md`
      (H-008).
- [ ] Base Mainnet deployment — **owner-gated**, see "What remains" (H-009).
- [x] Pool creation passes `playoffs` to `registerPool` (H-010).
- [x] Fee telemetry: `MarketFeeUpdated` decoded from each verified fill,
      persisted on `market_fills`, surfaced in the market activity feed (H-011).
- [x] Fee quote: `DynamicMarketHook.quoteFee` (same code path as
      `beforeSwap`) drives `BuiltMarketTrade.fee`; the UI shows
      Position / Estimated fee / Total from that quote (H-012).
- [x] Documentation: `docs/fee-model.md` (users), `docs/architecture.md`,
      spec §16–§18/§27/§29 updated (H-014).

## Failure conditions

- Any reachable state returns `feePips > MAX_RATE`.
- A regular-season pool charges a non-zero fee.
- The fee at `p = 0.5` is lower than at any other `p` for the same conditions.
- A keeper, operator, or hook call can change the ceiling or the floor.
- The server quote and the hook's `beforeSwap` disagree on the pip fee for
  the same pool state.
- A fee-math function reverts on a degenerate input (zero liquidity, zero
  price, max amounts).

## Edge cases

- `p = 0` and `p = 1` (pool pinned at a bound): fee is 0 per contract; the
  pip rate is `r` at `p = 0` (contracts are worth nothing) and 0 at `p = 1`.
- Tiny trades (1 raw unit): fee rounds to 0 or 1 unit, never reverts.
- Huge trades: the per-swap cap rejects them before the fee is charged, but
  the pure math must not overflow up to `type(uint128).max` contracts.
- Stale keeper in the regular season: still 0 (season wins).
- Both token orderings (YES as token0 / token1) produce the same fee.
- Same-block re-quote: identical fee (flow does not decay within a block).

## Implementation checklist

- [x] Task doc, prompt history, D-105.
- [x] `RiskPolicy.sol` bounds + `clampRate`.
- [x] `MarketFeeFormula.sol` (pure formula) + tests + shared vectors.
- [x] `MarketFeeCalculator.sol` four-driver rate, season gate, breakdown.
- [x] Registry / interface / flow: `playoffs` per pool.
- [x] Hook: `quoteFee` view, event with breakdown, `beforeSwap` returns the
      shaped fee.
- [x] Test suites: formula, calculator, policy, hook, registry, invariant,
      scenario, manipulation; integration tests updated for the new
      `registerPool` signature.
- [x] Server: season type from providers → `PlannedMarket.playoffs` →
      `registerPool`; `market-fee.ts` mirror + hook quote in
      `buildMarketTrade`; fill telemetry + migration 0019; activity feed.
- [x] Client: fee line in the trade sidebar.
- [x] Docs: spec, architecture, README, fee-model page, deploy runbook,
      security review, findings, sign-off addendum.
- [ ] Deploy to Base Mainnet + verify (owner runs the runbook).

## What remains

**H-009 (deploy) is not done in this task.** It needs the owner's funded
deployer keystore and a BaseScan key, neither of which exists in this
environment, and D-112 pauses chain-committing work until the owner's
launch-chain decision after 2026-09-17. `deploy/dynamic-market/README.md`
carries the exact commands; `SaltMine.t.sol` proves the mine against the new
initcode. Once deployed, populate `DYNAMIC_MARKET_BY_CHAIN` and re-run
`npm run verify:hooks`.

The external o3 / Gemini review steps in the house process were not run —
this session has no route to those APIs; the review that was possible is the
AI-assisted security pass in `docs/security/dynamic-market-fee-review.md`.
