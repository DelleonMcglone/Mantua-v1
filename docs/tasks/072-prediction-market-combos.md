# Task 072 — Prediction Market Combos (Phase 16, CB-001 … CB-010)

> Numbering follows the owner's master list of 2026-09-16, refreshed
> 2026-09-19 (`docs/tasks/mantua-v1-task-list.md`), where Phase 16 is the
> parlay-like combo experience, 🟢 P2 and explicitly not a launch
> dependency. Phase 14 (Base Builder Code) stays skipped at the owner's
> direction; Phase 15 shipped as task 071.

**Branch:** `claude/agent-extended-social-reputation-dzi0fj` (restarted from `main` at `fa2f63c`)
**Prompt history:** `docs/promptHistory/2026-09-19-prediction-market-combos.md`
**Decision:** D-119 (`docs/decisions/v2-open-decisions.md`) — a combo is a conjunction market.

## Description

A combo is _Cowboys win + Chiefs win + Raiders win_ as one trade: a small
stake, one confirmation, one transaction, one position that pays out only
if every leg wins. It has to feel like a parlay and settle like a
prediction market.

One rule carries the phase (D-119): **a combo is a market.** The legs are
YES sides of existing moneyline markets; the combo itself is a new
full-collateral market whose YES token pays $1 if every leg resolves YES.
It is created through the same factory, priced by the same Uniswap v4
pool with the same Dynamic Market Hook fee, bought with the same single
swap the trade ticket already signs, marked at the same pool price, and
settled through the same resolver. Nothing new touches the chain: no new
contract, no batching, no counterparty desk. What is new is the
composition (which legs may be bundled and at what fair price), the
conjunction settlement rule, the ticket, the position, and the agent.

The phase, by row:

1. **Mechanism (CB-001).** `computeComboMarketId` derives a deterministic
   market id from the sorted leg ids, so the same legs always name the
   same market and two users who build the same combo share one pool.
   The combo market's `startsAt` is the latest leg kickoff; its label is
   the legs joined. Correlated legs are refused in code, never priced.
2. **Builder (CB-002).** A Combo panel: add a team from any game row
   (`+ Combo`), see each leg with its live price and implied odds, set a
   stake, review the combined odds, the payout and the fee lines, then
   confirm — the same ticket machinery, the same wallet flow.
3. **Pricing engine (CB-003).** `priceCombo` computes the fair
   probability (the product of the legs' pool prices), the combined odds,
   the shares a stake buys at the pool's own quote, the payout at par,
   and the premium of the pool price over fair. Before the combo market
   exists, the quote is an opening estimate at the fair price with the
   hook's own fee formula, labelled `planned`; once it exists, the quote
   is the pool's.
4. **Fees (CB-004).** One swap, one fee, from the hook's `quoteFee` —
   the single-trade standard: Position / Fee / Fee rate / Total from the
   hook's number, rounded up, the 0.70 % ceiling enforced as a render
   refusal. The review also shows what the same legs would cost as
   separate tickets, from each leg's own hook quote.
5. **Single transaction (CB-005).** `POST /api/combos/prepare` creates
   the conjunction market on-chain when absent (operator key, idempotent,
   the sports-sync's own `createMarketsOnChain`); `POST /api/combos/calldata`
   is one `PoolSwapTest.swap` on the combo pool, cap-checked once for the
   whole stake; `POST /api/combos/fills` verifies the receipt and records
   the ticket. Not deployed → the same `MARKETS_NOT_DEPLOYED` a trade gets.
6. **Agent-constructed combos (CB-006).** `mantua_build_combo` proposes a
   combo from the slate and the user's policy: legs ranked by edge
   (consensus probability vs pool price), leg count and stake from the
   risk level, every combo rule and limit applied in code. The proposal
   is a preview; execution rides the confirmation gate with a fresh
   re-quote and the material-drift rule.
7. **Settlement (CB-007).** `comboOutcome` over the legs' on-chain
   resolutions: any leg lost → lost; every non-void leg won → won; every
   leg void → void; a void leg drops out. The resolution cron freezes and
   resolves the combo market from that verdict through the resolver,
   with its own authorization mint whose evidence is the legs' on-chain
   states. Leg results are stamped as they land, so a ticket shows
   `2 of 3 won · 1 pending` long before the last game.
8. **Portfolio (CB-008).** Tickets are first-class: a Combos section on
   the profile (desktop and the phone's Positions tab), marked at the
   combo pool price, counted in the holdings aggregate, with `combo_open`
   / `combo_close` / `combo_settle` on the activity timeline.
9. **Agent monitoring (CB-009).** A fifteen-minute tick evaluates every
   open ticket: stamps leg results, marks the ticket dead the moment a leg
   loses, and — where the mechanism permits — manages it: a take-profit
   sale of the combo position when the mark clears the policy threshold,
   or a hedge of a remaining leg in that leg's own market. Agent-wallet
   tickets under an autonomous policy execute; every other ticket gets a
   recommendation on the timeline (and a push). A conjunction token cannot
   cash out one leg; the tick never pretends otherwise.
10. **Risk limits (CB-010).** Platform limits in env (`COMBO_MAX_LEGS`,
    `COMBO_MAX_STAKE_USDC`, `COMBO_MAX_OPEN_MARKETS`, `COMBO_SEED_USDC`),
    user limits in the policy's `combo` block (enabled, max legs, max
    stake, max open exposure, max payout, take-profit threshold, auto
    manage), correlated-leg controls in code (same event, same team,
    duplicate market), all enforced by `comboPolicyGate` before any quote.

## Success criteria

1. `computeComboMarketId` is order-independent, distinct from every
   moneyline id, chain-mixed off Base, and specified in
   `docs/specs/market-id.md`. (CB-001)
2. The rules refuse fewer than two legs, more than the platform cap, a
   duplicate market, two legs from one event, the same team twice, a leg
   whose market is not OPEN, and a leg past kickoff-final; each refusal
   names the leg. (CB-001, CB-010)
3. The builder goes select → add legs → review each leg → combined
   position and payout → fee lines → confirm, with every displayed number
   from the server's quote and nothing re-derived. (CB-002)
4. `priceCombo` yields fair probability = Π leg prices, combined odds =
   1 / effective price, payout = shares at par, premium = pool vs fair;
   a planned quote uses the hook's fee formula and says so. (CB-003)
5. Fee lines for a combo equal `feeLines(feeSummary(stake, hookFee))`,
   the ceiling guard applies, and the separate-tickets comparison is the
   sum of the legs' own hook quotes. (CB-004)
6. A combo is one swap: `/calldata` returns one `to`/`data`, the cap is
   checked and recorded once for the full stake, and `/fills` records one
   ticket with N legs from one receipt. (CB-005)
7. The agent's proposal respects the policy's leagues, leg count by risk
   level, stake caps and exposure; a confirmed proposal executes only
   after a fresh quote within the drift rule. (CB-006)
8. `comboOutcome` covers won / lost / void / pending with a void leg
   dropping out; the cron freezes then resolves through the resolver
   with a `combo-conjunction` authorization; tickets and legs are
   stamped. (CB-007)
9. Tickets appear on the profile with mark, P&L, per-leg status and
   payout; the holdings aggregate has a `comboPositionsUsd` part; three
   activity kinds render on the timeline. (CB-008)
10. The monitor tick stamps legs, marks dead tickets, sells at take-profit
    or hedges a leg for autonomous agent-wallet tickets, and records a
    recommendation otherwise; it never sells one leg of a conjunction.
    (CB-009)
11. `comboPolicyGate` enforces every user limit; the env limits bound
    every request; the policy patch validates the `combo` block strictly.
    (CB-010)

## Failure conditions

- A combo pays or is marked as if legs were independent positions (sum
  of payouts) anywhere the user can see.
- Two legs from the same game, or the same team twice, reach a quote.
- A combo's fee, payout or shares shown on the ticket differ from the
  hook's or the pool's own number.
- A ticket's stake is cap-checked per leg, or twice.
- A combo market resolves from anything other than its legs' on-chain
  resolutions, or before every deciding leg has resolved.
- A monitor action sells or closes "one leg" of a combo position.
- A route in `routes/combos.ts` or `routes/cron-combos.ts` lacks its
  guard (`route-guards.test.ts`).
- Any file over 150 lines among the new modules.

## Edge cases

| Case                                            | Handling                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Same legs, different order                      | Sorted before hashing → one market id                                                                    |
| Leg market resolves before the combo's startsAt | Leg stamped; ticket `dead` or `alive`; on-chain freeze waits for the latest kickoff (Market.freeze rule) |
| A leg voided                                    | Drops out; the remaining legs decide; all void → combo void, tokens pay $0.50 (B4-005)                   |
| Combo market not yet created                    | Quote is `planned` at fair price; `/prepare` creates it; `/calldata` refuses until it exists             |
| Markets not deployed on the chain               | 503 `MARKETS_NOT_DEPLOYED`, the trade route's own code                                                   |
| Operator reached `COMBO_MAX_OPEN_MARKETS`       | `/prepare` answers 409 `COMBO_CAPACITY`; existing combo markets still trade                              |
| Stake above the platform or policy cap          | 400 with the gate's reasons; nothing quoted                                                              |
| Same user builds the same combo twice           | Two tickets, one market; balances aggregate on-chain, tickets keep their own basis                       |
| Receipt for a tx not on the combo pool          | `/fills` 422 `WRONG_TARGET`, exactly like a market fill                                                  |
| Pool price unreadable at monitor time           | Ticket reported unmarked; no action taken                                                                |
| Agent policy has no `combo` block               | Defaults apply (enabled, 3 legs, $25 stake, $100 exposure, take-profit 80 %)                             |
| Sell of a combo position                        | `/calldata` with `direction: sell` on the combo market; ticket `closed` with proceeds                    |
| Timeline kind added on the server only          | Client `KINDS_BY_CATEGORY` test asserts every server kind is categorised                                 |

## Implementation checklist

### Mechanism, pricing, rules

- [x] `computeComboMarketId` + `"combo"` market type; spec section (CB-001)
- [x] `combo-rules.ts`: leg validation, correlated-leg controls, label, startsAt (CB-001, CB-010)
- [x] `combo-pricing.ts`: fair probability, odds, planned/pool quotes, premium (CB-003)
- [x] `combo-policy.ts`: `combo` policy block, defaults, patch schema, `comboPolicyGate` (CB-010)
- [x] Env limits: `COMBO_MAX_LEGS`, `COMBO_MAX_STAKE_USDC`, `COMBO_MAX_OPEN_MARKETS`, `COMBO_SEED_USDC` (CB-010)

### Chain and routes

- [x] `buildMarketSwap` extracted from `buildMarketTrade` (shared by trades and combos) (CB-005)
- [x] `combo-market.ts`: plan + ensure the conjunction market; `buildComboTrade` (CB-005)
- [x] Migration 0024: ticket columns on `combos`, leg columns on `combo_legs` (CB-005, CB-008)
- [x] `combo-store.ts`: place, list, stamp, settle, close, open exposure (CB-005, CB-008)
- [x] `routes/combos.ts`: GET tickets, quote, prepare, calldata (one cap check), fills (CB-002 … CB-005)
- [x] Audit actions, activity kinds, execution-mode attribution (CB-008, AE-013 parity)

### Settlement and monitoring

- [x] `combo-settlement.ts`: `legResultFrom`, `comboOutcome`, `planComboResolution` (CB-007)
- [x] `authorizeComboResolution` mint with leg-state evidence (CB-007)
- [x] Resolution cron runs the combo pass after the leg pass (CB-007)
- [x] `combo-monitor.ts`: leg stamping, dead tickets, take-profit / hedge decisions (CB-009)
- [x] `routes/cron-combos.ts` + `.github/workflows/combos.yml` every 15 min (CB-009)

### Agent

- [x] `combo-agent.ts`: `proposeCombo` from slate + policy (CB-006)
- [x] `mantua_build_combo` / `mantua_execute_combo` tools, `combo` preview kind, drift check (CB-006)
- [x] Agent-wallet combo execution through the Circle path (CB-006, CB-009)

### Client

- [x] `features/combos/combo-core.ts`: builder reducer, odds/payout display, fee comparison (CB-002, CB-004)
- [x] `ComboBuilder` panel + `+ Combo` on game rows + route + nav (CB-002)
- [x] `useComboTrade` on the shared trade transport (CB-005)
- [x] `ComboPositionsSection` on the profile and the phone's Positions tab; holdings part (CB-008)
- [x] Activity kinds on the client; policy panel `combo` limits (CB-008, CB-010)

### Docs

- [x] D-119, architecture section, roadmap Phase 16 tables, task list, market-id spec, `.env.example`

## Notes

- **No Solidity.** Foundry is not available in this session and the
  contracts need no change: the factory takes any `bytes32` id, the
  resolver resolves any market it created, and `voidMarket` covers the
  all-void case. D-119 records why a combo desk contract was rejected.
- **Deployment-gated like everything on-chain.** `MARKETS_BY_CHAIN` is
  empty until D-112; the planning and decision paths are pure and tested,
  the chain legs degrade exactly as trades do.
- **The public ledger (Phase 13)** reads `market_fills`. Combo tickets
  are their own ledger (`combos`) and are not yet folded into the public
  performance page; recorded as the follow-up in D-119.
- **Review round.** The repository's code-review pass (`code-review main
high`; Gemini and o3 are not reachable from this session) returned ten
  findings. Nine are fixed in this change; one is pre-existing and
  outside the phase:
  1. The monitor's hedge buy bypassed the daily cap and the C-015 ledger →
     `checkSpendingCap` before the buy, the spend inked by the finalization
     claim winner, the execution persisted as `combo_trade`.
  2. `/prepare` created operator-seeded markets with no rule or policy
     gate and a capacity count over tickets → one `prepareComboMarket`
     path (rules, policy switch, capacity over every prepared market,
     recorded as a `draft` row) for the route and the agent alike.
  3. The sell fill was neither idempotent nor bound to the combo → replay
     guard on the close stamp; the receipt's transfer logs decide the
     market and the amounts.
  4. `combo_trade` finalization only audited → the webhook finalizer now
     records the spend and the ticket / close itself, and the in-process
     path writes only when it wins the claim.
  5. `/fills` credited the caller for any router transaction with
     client-supplied amounts → sender must be the caller's linked wallet
     (403 `WALLET_MISMATCH`), amounts from the logs, 422 `WRONG_MARKET`
     when the receipt shows no swap of this combo's token.
  6. The calldata gate passed `payoutUsd: 0` and skipped the leg rules →
     rules and the gate with the legs' implied payout on the commit path.
  7. The quote read the combo market twice and quoted leg fees serially →
     the chain view is passed through; leg fees run in parallel.
  8. A needless dynamic import of `argsHash` → static import.
  9. The monitor read the policy once per ticket → once per user.
  10. `client/public/sw.js` caches any navigation response (pre-existing,
      Phase 15) — left for its own change.
