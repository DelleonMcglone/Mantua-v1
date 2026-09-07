# 046 — Market data spine + in-play alignment (P-002 / P-006 / P-011 / P-012)

**Status:** ✅ done 2026-09-06
**Branch:** `046-market-data-spine`

The server+client data spine behind D-103's in-play decision: the price-tick
and position tables gain their first writers, settlement becomes automatic,
quoting halts on an in-play feed outage, the hedging engine and the trade UI
stop freezing at kickoff, and the marketId preimage binding is persisted and
verified at creation. Contract-side in-play changes (hook freeze semantics)
are a parallel lane (045); everything here is the off-chain half.

## Seam table — writer → table → reader → status

| Writer (new)                                                    | Table / column                              | Reader (already shipped)                                                                 | Status |
| --------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| verified-fill path (`routes/market-fills.ts`)                   | `market_prices` (source `fill`)             | `history.ts` price series, `market-metrics.ts`, agent `get_market_price`/`get_market_history`, detail chart | ✅ wired |
| `snapshotMarketPoolPrices` (market-metrics.ts) ← sync cron      | `market_prices` (source `pool`, + liquidity) | same readers                                                                              | ✅ wired |
| verified-fill path                                              | `market_positions` (aggregate per market/wallet/side) | portfolio P/L, `market-metrics.ts` open interest                                          | ✅ wired |
| `settleResolvedPositions` (markets-onchain.ts) ← sync cron      | `market_positions.settled_at/settlement_price`, `redeemed_at/redeem_tx_hash` (agent wallets) | redeemable API (claimables), portfolio realized P/L                                       | ✅ wired |
| `upsertMarketRows` (store.ts)                                    | `markets.provider/provider_event_id` (binding) | anyone recomputing the keccak preimage                                                    | ✅ wired |

## 1. P-011 — price-tick recording (`market_prices` had ZERO writers)

- **Fill ticks.** `POST /api/markets/fills` (receipt-verified,
  unique-on-txHash) now writes one `market_prices` row per NEWLY inserted
  fill: source `fill`, implied probability = the trade's effective price
  `usdc / tokens` clamped to [0, 1] (`fillImpliedProbability`, pure +
  tested). Idempotency rides the fill insert itself — the tick (and the
  position update) are gated on `.returning()` producing a row, so
  re-POSTing the same tx writes nothing twice.
- **Pool snapshots.** `snapshotMarketPoolPrices` (market-metrics.ts) runs on
  every sports-sync tick, per chain: every OPEN market with a pool gets a
  `pool` tick read exactly the way live-odds/metrics read prices (StateView
  `getSlot0` → implied probability; `getLiquidity` rides along
  best-effort). Cadence dedupe is the pure `poolSnapshotDue` (min 60 s
  between `pool` ticks per market), so overlapping/re-run crons cannot
  stack duplicates. Returns null when the market stack is not deployed on
  the chain (the `marketsCfg` degrade-to-planning pattern — no throw).
- **Readers verified against the written shape**: decimal 0–1 probability
  strings at 5 dp, `capturedAt` ordering desc/asc as each reader expects;
  `source` vocabulary extended (`pool | consensus | opening | fill`) in the
  schema comment.
- **Chart** (`routes/market-detail.ts`) now prefers the recorded
  `market_prices` series (probability → bps) and keeps the fills-derived
  series as the fallback for pre-046 markets.

## 2. P-006 — positions + automatic settlement

- **Writers.** The schema's intent is an aggregate mirror ("average entry"
  column), so the fill path maintains ONE row per (market, wallet, side)
  (new unique, migration 0018): buys grow `size` and re-average
  `entryPrice` in a single atomic upsert whose RHS expressions read the OLD
  row (race-safe under the unique); sells shrink at average cost, floored
  at zero (split-acquired tokens the mirror never saw stay the chain's
  business). `userId` resolves via the ensureUser pattern from the
  authenticated Privy id.
- **Settlement pass** (`settleResolvedPositions`, wired into the sync cron
  after reclaim): for markets whose DB state is RESOLVED/SETTLED/INVALID,
  every unsettled position is stamped `settled_at` + `settlement_price`
  ($1 winning side / $0 losing / $0.50 INVALID — `settlementPriceFor`,
  pure). Winner comes from the resolutions log (market vocabulary, later
  rows supersede); an unknown winner HOLDS (`heldUnknownWinner`), never
  guesses. Decision logic is the pure `planPositionSettlement`.
- **Agent auto-redeem.** Positions whose wallet is in `agent_wallets`
  (Circle DCW, server-controlled) auto-redeem through the existing
  machinery: live on-chain state picks `redeem` vs `redeemInvalid`
  (`redeemFunctionForOnchainState`, exactly like the user route), the
  market address is admitted to the Circle allowlist from OUR factory read
  (`registerDynamicTargets`, the agent-trade pattern), execution goes
  through `executeAgentCalldata` (receipt-confirmed), and success stamps
  `redeemed_at`/`redeem_tx_hash` + a `market_redeem` audit row
  (`automated: true`). Redemption is an inflow — no spending cap, matching
  the user redeem route. Zero-balance wallets stamp the mirror and move on
  (idempotent convergence). Undeployed chain → the leg reports itself
  disabled; DB-marking still runs.
- **No double-counting.** `settled_at` (realized P/L) and `redeemed_at`
  (claimed) are separate facts: user-custody positions stay
  settled-but-unredeemed, which is exactly what the redeemable API surfaces
  as claimable (it reads live chain balances, so a claim can never be
  offered twice).

## 3. P-012 — server-side quoting halt on feed outage

- `assessMarketTradability` (market-trade-build.ts, pure + tested) is the
  D-103 window in one place: **closed** on final/postponed/cancelled, on a
  FROZEN/RESOLVED/SETTLED/INVALID market row, or past the
  `startsAt + MAX_EVENT_DURATION_SECONDS` (12 h) backstop; **halted** —
  buys only — while the event is in play and the canonical row's
  `last_polled_at` is older than `IN_PLAY_FEED_MAX_AGE_MS` (10 min ≈ two
  missed sync ticks; a missing poll record counts as an outage, never as
  fresh); **open** otherwise. Gate data comes from the canonical DB
  (`readCanonicalSlate`'s freshness source, `events.last_polled_at`).
- `buildMarketTrade` consults the gate and throws typed errors:
  `MarketClosedError` (409 `BETTING_CLOSED`) or the new
  `MarketDataOutageError` → 503 `TRADING_HALTED` on the route. Sells are
  exits and always build — existing positions and LP exits ride through an
  outage untouched; on-chain stays open-but-clamped (the hook's job, per
  D-103). Both legs tested.
- This replaced the old on-chain `startsAt <= now` kickoff gate (the old
  pre-in-play freeze). An event unknown to the canonical DB falls back to
  the on-chain kickoff timestamp with the backstop-only check.

## 4. In-play alignment (P-004 support)

- **Engine.** `ticksFromSlates` freeze moved from "kickoff or
  in_progress/final" to D-103's clock: FINAL/void, or the 12 h backstop
  (`MAX_EVENT_DURATION_SECONDS`, exported from strategies.ts). Strategies
  now stay armed and execute DURING games. `hedging-e2e.test.ts` gained an
  in-play leg (in_progress + pool cross → executed) and its disarm leg now
  proves the moved freeze via the permissionless backstop (a feed stuck
  mid-game past `startsAt + 12h` disarms `market-frozen` with zero
  executions/spend; a reported final disarms `market-resolved`, covered in
  strategies tests). B10-006's "disarms on freeze" property survives —
  the freeze moved.
- **Reband window.** `listRebandCandidates` now spans pre-game AND in-play
  (`startsAt >= now − 12h`) — books stay OPEN through the game, so
  out-of-band prices can appear (and must be arbed) until final. The
  sweeper still trusts only on-chain state per market.
- **Client gating that actually existed** (read before changing):
  - `LeaguePage.tsx` GameRow: `tradeable = liveOdds && status === "scheduled"`
    → price buttons disabled from kickoff on; also the default sidebar
    selection only picked scheduled games; footer copy said "Trading halts
    at kickoff."
  - `SlateList.tsx`: the Trade action on a matchup card gated on
    `status === "scheduled"`.
  - `MarketDetail.tsx` / `use-market-trade.ts`: no kickoff gating of their
    own (the sidebar quotes whatever the server allows).
  All now gate on the shared `isTradableStatus` (scheduled OR in_progress;
  final/void closed) in market-trade-core.ts, and the footer copy reads
  "Trade before or during the game — trading closes when the game goes
  final."
- **Explorer link removed** from `MarketDetail.tsx`'s activity tab
  (`const EXPLORER = "https://basescan.org/tx/"` + its render) — chain
  branding out of user UI per P-010/D-104; the ops surface is 044's lane.

## 5. P-002 — binding + plan-from-canonical

- **Plan from canonical.** The sync cron no longer plans markets off the
  live provider slate. One slate fetch feeds `upsertEvents`, then
  `planMarketsFromCanonical` (store.ts) reads the PERSISTED scheduled
  events back and hands them to the pure `planCanonicalMarkets`
  (ingest.ts): the DB rows are the planning universe (identity, clock,
  home/away — the outcome-index anchor the store's side-conflict guard
  protects), the feed contributes only what the schema doesn't persist
  (abbreviations for labels, opening odds). A canonical game the feed
  dropped, or whose feed sides contradict the stored row, is skipped and
  counted — never planned blind. Deterministic, so idempotency through
  `createMarketIfAbsent` is unchanged.
- **Binding persisted at creation.** Migration 0017 adds
  `markets.provider` + `markets.provider_event_id` — the two keccak
  preimage inputs not already columns (marketType/outcomeIndex/chainId
  were). `upsertMarketRows` persists them write-once (coalesce — a later
  sweep backfills pre-046 nulls but never overwrites) and runs the
  recompute check first: `computeMarketId(preimage) === marketId` or the
  row is refused with an error log (id and claimed preimage disagreeing is
  corruption, not data).

## Migrations (scratch-Postgres verified, 038/041 style)

- `0017_market_binding.sql` — `markets.provider`, `markets.provider_event_id`.
- `0018_position_settlement.sql` — `market_positions.settled_at`,
  `settlement_price`, and the `(market_id, wallet_address, side)` unique
  (safe: the table had zero writers, so no rows exist to conflict).
- **Numbering note:** these landed as 0016/0017 before task 044 merged its
  own `0016_resolution_dispute_window`; the branch was rebased onto main
  and both files renumbered to 0017/0018 with journal indices 17/18 after
  044's 16 (union-by-tag then reindex, the 038/041 journal pattern). No SQL
  changed — the two lanes touch disjoint tables (044:
  `resolution_reviews`/`resolutions`; 046: `markets`/`market_positions`).
- Full chain 0000→0018 applied to a scratch Postgres 16 via psql;
  0017/0018 re-applied as clean no-ops (IF NOT EXISTS convention), and
  044's dispute-window/operator-hold columns verified present alongside
  ours on the same database. A smoke
  script then ran the REAL writers against the scratch DB: canonical
  plan → `upsertMarketRows` (binding persisted; corrupted id refused;
  write-once verified) → two buys + one sell through
  `recordFillArtifacts` (3 fill ticks; ONE aggregate row, 15 YES @
  0.70000 weighted entry) → resolve → `settleResolvedPositions`
  (settled at 1.00000, redeemedAt null, second pass scans zero) →
  `snapshotMarketPoolPrices` null-degrade with no deployment.

## Interaction with task 044 (D-104 dispute window), post-rebase

Checked explicitly after rebasing onto 044:

- **Settlement sweep** — 044 only *delays* when `markets.state` flips to
  RESOLVED/INVALID (the dispute window gates the on-chain submit; the
  `drizzleResolutionLog.record` write is unchanged). The sweep is triggered
  by that state, so a market parked in its dispute window is simply not yet
  settleable — correct by construction, no new branch needed. 044's manual
  override writes a `resolutions` row with method `manual` and a winner;
  the sweep's winner map reads all rows for the market ordered by
  `created_at` with later rows winning, so an override supersedes the
  automated call exactly as the redeemable API already treats it.
- **Trade halt** — a game awaiting its dispute window is `status = "final"`
  in the canonical `events` row, and `assessMarketTradability` closes on
  `final` before the market row's state matters. There is no window where a
  finished-but-unresolved game is quotable.
- **Schema/migrations** — disjoint tables; both migrations verified on one
  scratch database.

## Gates

- Server: typecheck 0 errors, lint `--max-warnings 0` clean, stub-env tests
  **733 pass / 0 fail** (703 on main after 044; +30).
- Client: typecheck 0 errors, lint clean, tests **131 pass / 0 fail**
  (130 on main; +1).

## Honest notes / follow-ups for other lanes

- `client/src/features/portfolio/StrategiesSection.tsx` still says
  "Strategies auto-disarm at kickoff", and
  `client/src/components/docs/docs-content.tsx` says "trade under this hook
  until kickoff freezes them" — both out of this task's strict lane
  (markets features only); copy needs the D-103 update in their owning
  lane.
- The trade sidebar surfaces the typed halt/closed messages via the
  existing ApiError plumbing (no special-casing added); a dedicated
  "trading paused" banner is UI polish for later.
- `buildMarketTrade`'s gate reads the canonical DB; the strategy executor
  and agent trade share it, so an in-play outage also refuses agent BUYS
  while strategy closes (sells) keep working — the D-103 intent.
- The on-chain hook still enforces kickoff-freeze until 045 lands; until
  then an in-play buy the server now allows would revert on-chain. The
  server semantics are D-103-final and land first by design (the UI copy
  and gating stay truthful the moment the hook flips).
- **Cross-lane, needs the resolution lane (044/045 owners):**
  `planResolution` in `server/src/lib/sports/resolution.ts` still sweeps an
  on-chain `freeze` for every event where `startsAt <= now` and the status
  is scheduled/in_progress — the pre-D-103 kickoff freeze. Left untouched
  (resolution\*.ts / cron-resolution.ts are explicitly outside this lane),
  but it must move to freeze-on-final + the 12 h backstop alongside the
  hook change, or the resolution cron will freeze markets at kickoff that
  the server and UI now treat as in-play. Nothing writes
  `markets.state = 'FROZEN'` in the DB today (only resolve/void write
  state), so this does not currently short-circuit the server-side gate —
  the gate's FROZEN branch is forward-looking for when a writer exists.
