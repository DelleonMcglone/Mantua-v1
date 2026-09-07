# 047 — In-play freeze sweep (D-103 correction in the resolution cron)

**Status:** ✅ done 2026-09-06
**Branch:** `047-inplay-freeze-sweep`
**Decisions:** D-103 (in-play trading) — `docs/decisions/v2-open-decisions.md`
**Follows:** 045 (contracts), 046 (server/client data spine)

A single-purpose correction lane. Tasks 045 and 046 moved the contracts, the
server trade gate, the hedging engine and the UI onto D-103's in-play model.
`planResolution` did not move with them, and the resolution cron is the one
component that holds the resolver key — so it was the one component that could
still close a market the rest of the system considers open.

## 1. The bug

`server/src/lib/sports/resolution.ts` swept an on-chain `freeze` for every
event whose kickoff had passed:

```ts
// before
if (
  event.startsAt <= nowSeconds &&
  (event.status === "scheduled" || event.status === "in_progress")
) {
  plan.freezes.push(...marketIdsFor(event.providerEventId, chainId));
}
```

That is exactly the pre-D-103 kickoff freeze, and it is the *only* status
combination the new model must never freeze. Under the shipped 045 contracts
`Market.freeze()` is **resolver-only** from `startsAt`, so this sweep was not
a harmless no-op that would revert: the cron signs with the resolver key, so
it is precisely the caller the contract lets through that window. Every
`in_progress` game on the slate would have been frozen at kickoff on the first
cron tick after the deploy — silently reverting the owner's decision in
production while the trade gate, the hook and the UI all advertised in-play
trading.

Found by the 046 lane and flagged as out-of-lane
(`docs/tasks/046-market-data-spine.md` §"Honest notes", last bullet); this
task is that bullet and nothing else.

## 2. Old rule vs new rule

| | Old (pre-D-103) | New (D-103, this task) |
| --- | --- | --- |
| Trigger | `startsAt <= now` **and** status ∈ {scheduled, in_progress} | status == `final` (with `startsAt <= now`) **or** `startsAt + MAX_EVENT_DURATION_SECONDS <= now` |
| Game in progress past kickoff | **frozen** | **never frozen** — trading runs through the event |
| Game gone final | not swept (settlement's in-line freeze caught it) | **frozen** — the data-driven close, which is what the resolver role is for |
| Stale in-progress game (feed never reported the final) | frozen at kickoff | **frozen at `startsAt + 12 h`** — the permissionless backstop |
| Before kickoff | never | never (`Market.freeze()` reverts before `startsAt` on both paths) |
| Idempotency | already-frozen reverts treated as success | **unchanged** — `liveResolutionSubmitter.freeze` still swallows revert → `null` |

```ts
// after
const kickedOff = event.startsAt <= nowSeconds;
const pastBackstop = event.startsAt + MAX_EVENT_DURATION_SECONDS <= nowSeconds;
if ((kickedOff && event.status === "final") || pastBackstop) {
  plan.freezes.push(...marketIdsFor(event.providerEventId, chainId));
}
```

The `kickedOff` conjunct on the final branch is not redundant: a feed that
reports a "final" for a game that has not started is bad data, and freezing it
would revert on-chain and land in `summary.failures` as noise. Both freeze
paths in `Market.sol` are closed before `startsAt`, so the planner mirrors
that shape.

Called-off games are unchanged and deliberately *not* in the freeze branch:
`voidMarket` accepts a market in `OPEN`, and `executeResolution` sweeps an
in-line freeze before every submission anyway.

### Why a delayed slate still freezes on `final`

The B10-004 asymmetry ("freeze on stale data, never settle from it") survives,
on a better argument. It used to rest on the freeze being timestamp-driven and
therefore unable to be wrong. The freeze is now data-driven, so the argument
is **monotonicity**: a stale snapshot reporting `final` was true when it was
fetched, and finals do not un-happen. Stale data can only be *behind*, so it
can never close a market that is still live. The backstop branch remains pure
clock and cannot be wrong at all. Settlement still holds on delayed data —
that half is untouched.

The B10-004 test now states this directly: on an outage slate carrying one
in-play game and one cached final, **the finished game's markets freeze and
the live game's do not**.

### The constant

`MAX_EVENT_DURATION_SECONDS` (12 h, mirroring `Market.MAX_EVENT_DURATION` ==
`RiskPolicy.MAX_EVENT_DURATION`) is **not duplicated**. It was defined in
`strategies.ts` (046), but `strategies.ts` imports `marketIdsFor` *from*
`resolution.ts`, so importing it back would have created a cycle. The single
definition moved down to the leaf both sides already import —
`server/src/lib/sports/provider.ts`, next to `isVoidStatus`/`isSettleable` —
and `strategies.ts` re-exports it, so every existing importer
(`market-trade-build.ts`, `store.ts`, the strategy/hedging tests) is
unchanged. Value unchanged; one definition, three consumers' worth of imports.

## 3. What was NOT changed

- **D-104 dispute window (044)** — untouched. Orthogonal and correct.
- **S-022…S-026 integrity gates** — untouched and not weakened. Resolution
  still requires FROZEN first (`market_frozen` criterion, plus the
  executor's in-line freeze before every submission), still passes the
  9-criteria gate, still refuses on `DISPUTED`/`MANUAL_REVIEW`, stale feeds
  and store contradictions. The only thing this task changes is **when** the
  freeze is swept.
- **`kickoff_elapsed` criterion** (`resolution-criteria.ts`) — untouched. It
  is a plausibility check (a "final" less than `MIN_GAME_DURATION_SECONDS`
  after kickoff is a data error), not a proxy for "closed", so D-103 does not
  touch it.
- **Catch-up freeze in `executeResolution`** — behaviour unchanged, comment
  corrected. It exists for a market whose freeze never landed (the sweep was
  down when the final arrived); by the time a submission exists the event is
  final or void, so it is the same data-driven close, not a kickoff freeze.

## 4. Tests

`server/src/lib/sports/resolution.test.ts` — the freeze rule is now four
tests where it was one, plus a freeze-ordering test in the executor block:

| Test | Proves |
| ---- | ------ |
| "never freezes a game that is merely past kickoff" | (a) in_progress at +10 min, in_progress at +3 h, and a kicked-off game the feed still calls `scheduled` all yield **zero** freezes |
| "freezes both markets of a game that has gone final" | (b) a final sweeps exactly that game's two market ids |
| "freezes a stale in-progress game once the 12 h backstop elapses" | (c) `startsAt == now − MAX_EVENT_DURATION_SECONDS` freezes; one second short of the backstop does not (boundary pinned on the real constant, not a literal) |
| "never freezes before kickoff" | the contract shape — a future game, and a bad-data "final" for a future game, are both untouched |
| "a resolve still freezes first" | (d) for each market, a `freeze` call precedes its `resolve` call, and the plan for a final already carries the freeze |
| B10-004 "still freezes on delayed data, but never settles from it" (rewritten) | the outage asymmetry on the new clock: finished game frozen, in-play game left open, nothing settled |
| "freeze sweep counts and tolerates already-frozen markets" (retargeted) | idempotency, now driven by a backstop-elapsed zombie instead of a kicked-off game |

(e) Unchanged and still green: the whole D-104 dispute-window suite
(`resolution-dispute-window.test.ts`, 044's lane — window opens on the first
gate pass, awaits, respects an operator hold, submits on elapse) and every
S-025 criteria-gate test (DISPUTED blocks, stale feed refuses, tampered
outcome caught, store contradiction refuses, missing context refused, voids
exempt) — none were touched.

## 5. Grep sweep — remaining kickoff-freeze assumptions repo-wide

Swept `server/`, `client/`, `contracts/`, `docs/`, `scripts/`, `api/`,
`landing/` for `startsAt <= now` as a closed-proxy, `status === "scheduled"`
as the only tradeable status, `FREEZE_LEAD`, and kickoff-freeze copy.

**Fixed in this task (in lane):**

- `server/src/lib/sports/resolution.ts` — the sweep itself, the
  `ResolutionPlan.freezes` doc comment, the executor's catch-up comment.
- `server/src/routes/cron-resolution.ts` — the two comments asserting the
  freeze is "timestamp-driven, cannot be wrong" (§1 pipeline docblock and the
  S-022 breaker block).
- `client/src/features/portfolio/StrategiesSection.tsx` — "Strategies
  auto-disarm at kickoff" → stay armed through the game, disarm on final
  (copy only; 046 flagged it, no other lane live).
- `client/src/components/docs/docs-content.tsx` — "trade under this hook
  until kickoff freezes them" → before and during the game, closing on final
  (copy only, same reason).

**Follow-ups for the owning lanes (reported, not edited):**

| # | Location | What | Severity |
| - | -------- | ---- | -------- |
| 1 | `server/src/lib/agent-chat.ts:198` | Live agent system prompt: "Only bet games whose slate status is scheduled AND whose start time is still in the future — betting freezes on-chain at kickoff". Asserts a false on-chain fact and makes the agent strictly more restrictive than the product. | **Functional — highest** |
| 2 | `server/src/lib/sports/strategy-parse.ts:112` (+ its assertion in `strategy-parse.test.ts:44`) | Strategy confirmation preview copy: "Auto-disarms at kickoff freeze, resolution, or expiry". User-facing, and the test pins it. | Functional copy |
| 3 | `server/src/lib/sports/strategies.ts:12` | Module-header safety-precedence comment still says "kickoff auto-disarms it", contradicting the same file's `ticksFromSlates` and its own §MarketTick doc. | Comment |
| 4 | `server/src/routes/cron-strategies.ts:25,31` | Route docblock describes pre-046 tick semantics ("freeze at kickoff"). | Comment |
| 5 | `server/src/lib/sports/strategy-engine.test.ts:344` | Test name "kickoff freeze disarms on the very tick…" — body is correct (`frozen: true`), label is stale. | Test name |
| 6 | `README.md:79,129,302` | The repo's front door still describes freeze-at-kickoff as the shipped lifecycle, and :302 mis-cites the since-revised `dynamic-market-hook.md`. (`:108` is fine.) | Docs |
| 7 | `docs/ops/incident-runbook.md:79,99-100` | Canned **public** incident-comms template promises "markets freeze automatically at kickoff" — a guarantee the contracts no longer make. Correct reassurance is the `startsAt + 12 h` permissionless backstop. | Docs — ops risk |
| 8 | `docs/architecture.md:628-632` | Security-rationale section argues kickoff protection must be timestamp-driven because "a started game tradeable against people who can see the field" is the hazard — the exact position D-103 reversed. The immutable-kickoff/no-setter sentence stays true. | Docs |
| 9 | `docs/architecture.md:436` | Comparison row frames in-game trading as hypothetical ("If live in-game trading ever ships") and endorses freeze-at-kickoff. | Docs |
| 10 | `docs/specs/dynamic-market-hook.md:144` | §1.1 in-scope list still names "Kickoff freeze"; the rest of the spec (§0.3, §6, §23, §35) was correctly rewritten by 045. | Docs |
| 11 | `docs/security/sign-off.md:111-112` | Inside the D-103 addendum: "the service-side strategy disarm still fires on the slate clock at kickoff… more conservative than the contract". 046 moved `ticksFromSlates`; the statement is now false. | Docs — cited evidence |
| 12 | `docs/security/dynamic-market-hook-review.md:116,132` | Dated 2026-08-17, carries no superseded banner, cites `FREEZE_LEAD` (removed from `contracts/src`) and `test_swapRevertsAfterKickoffWithoutAnyKeeperUpdate` (renamed by 045). | Docs — cited evidence |
| 13 | `docs/tasks/046-market-data-spine.md:224,229-234` | Two caveats now obsolete: "the on-chain hook still enforces kickoff-freeze until 045 lands" (045 merged) and the cross-lane `planResolution` note (this task). | Docs ledger |

Historical ledger rows in completed-task docs (`sports-pivot.md`,
`B2`/`B4`/`B10`, `035`, `042`, `040`) describe the pre-D-103 world accurately
for their date and were left alone; only `035-b9-execution-engine.md:78`
("in-game strategies: by design a strategy disarms at the freeze tick") reads
as a live scope statement rather than history.

**Verified clean — legitimate non-freeze uses of kickoff:** the contracts'
backstop arithmetic and once-only registration, the factory's creation-time
`KickoffInPast` guard, `resolution-criteria.ts`'s minimum-game-duration
plausibility check, fee dynamics/display/sorting anchored on kickoff, the
provider's `"kickoff"` play-type slug, and both trade gates
(`market-trade-build.ts` server-side, `market-trade-core.ts`'s
`isTradableStatus` client-side — no `scheduled`-only gate remains anywhere in
the client). `FREEZE_LEAD` is fully gone from `contracts/src`.

## 6. Files

- `server/src/lib/sports/resolution.ts` — the sweep, two doc comments.
- `server/src/lib/sports/provider.ts` — `MAX_EVENT_DURATION_SECONDS` moved
  here (single definition).
- `server/src/lib/sports/strategies.ts` — imports + re-exports it; no
  behaviour change.
- `server/src/routes/cron-resolution.ts` — comments only.
- `server/src/lib/sports/resolution.test.ts` — the tests in §4.
- `client/src/features/portfolio/StrategiesSection.tsx`,
  `client/src/components/docs/docs-content.tsx` — copy only.
- `docs/tasks/047-inplay-freeze-sweep.md` (this file),
  `docs/tasks/prediction-market-protocol.md` (ledger reconciliation).

## 7. Gates

- `npm run typecheck --workspace server` ✅
- `npm run lint --workspace server` ✅ (`--max-warnings 0`)
- Stub-env server suite: **737 pass / 0 fail** (733 on main after 044/045/046;
  only added — 5 new/retargeted tests replacing 1)
- `npm run typecheck --workspace client` ✅, `npm run lint --workspace client`
  ✅, client tests **131 pass / 0 fail** (unchanged — the two edits are copy)
