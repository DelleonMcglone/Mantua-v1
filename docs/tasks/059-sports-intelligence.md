# Task 059 — `sports_intelligence` and `mantua_analyze_market` (Phase 8, A-001/A-004/A-005/A-013/A-022)

> Owner directive 2026-09-12 (Phase 8 🤖 AI Agent Core, "continue starting
> with phase 8"). Ledger: `docs/tasks/ai-agent-core.md`. Decision record:
> D-114 (execution) and D-109 (policy) already bound what the skill may do;
> this lane adds the reasoning it does before asking.
>
> Gates: server typecheck ✅, lint ✅, **891 pass / 0 fail** (885 → 891); client
> untouched.

## Task description

The agent had thirteen sports data tools and a prompt paragraph telling
it to "evaluate before betting". Phase 8 asks for a built-in
`sports_intelligence` skill (A-004) with declared inputs and outputs, an
intelligence stack that composes sports, market and reasoning into a
trade / hedge / hold view (A-005), chat analysis for "should I buy the
Falcons YES?" with zero user data (A-013), and the `mantua_analyze_market`
tool (A-022). A-001 asked for the agent's skills to be reset from the
Circle Agent docs: Circle's documentation has no skills registry (it is
wallets, gateway, bridge and contract SDKs), so Mantua's skills are the
prompt's built-in skill list bound to the typed tools below.

### What landed

**`server/src/lib/agent/sports-intelligence.ts`** — the pure estimator
(`analyzeSide`). Additive, bounded, fully itemized adjustments on a 50/50
baseline:

| Component     | Weight                                                   |
| ------------- | -------------------------------------------------------- |
| Venue         | ±250 bps (NFL), ±300 (WNBA)                              |
| Season record | win% gap × 5,000 bps (from the standings snapshot)       |
| Recent form   | last-5 win% gap × 2,000 bps                              |
| Injuries      | out/doubtful −300, questionable −100 per player, cap 900 |
| Head-to-head  | (win share − 0.5) × 800 bps over recent meetings         |
| Live score    | 250 bps per point of margin, capped ±3,000, in play only |

Clamped to 5–95 %. The output carries every component with its effect,
the market's implied probability, `discrepancyBps` (estimate − market),
risk factors (missing records, thin form, stale price, thin pool,
delayed slate, in-play, final), a confidence grade, a suggested action
(`consider_buy_yes` / `consider_fade` / `hold` / `no_market_price`) that
only ever points at the simulation, and the disclaimers.

**`analyzeMarket`** (`lib/sports/agent-sports-tools.ts`) — the skill as
one tool over the `SportsToolsDb` seam: identifies the game and side (team
name via `getGame`'s fuzzy resolution, or providerEventId + outcomeIndex,
or marketId), gathers both sides' records, form and injuries, the
head-to-head from finished meetings, the live score, and the market's
price / depth / volume via `getMarketOverview`; runs the estimator; returns
the analysis, its inputs (so the model can cite them), and the exact
`mantua_simulate_trade` arguments for the suggested side.

**Prompt** — the "evaluate before betting" rule now routes through the
skill and asks for the evidence and risks in plain language; a
"Built-in skills" list (sports_intelligence, market_reads, execution,
treasury, research, policy_awareness) states what the agent is and that
anything outside it is declined (A-001, A-005).

### Options weighed

| Option                                              | Verdict | Why                                                                                                                              |
| --------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Let the model reason freely from the raw tools      | ✗       | Unrepeatable and unauditable; the estimate must be the same for the same facts and every weight must be visible to the user.     |
| A trained model / external odds API as the estimate | ✗       | Not in the canonical data posture (D-103 era rule: canonical DB first); x402 odds services remain an add-on the prompt may cite. |
| Suggest a trade size                                | ✗       | Sizing is the simulation's job under the cap and the policy; the skill hands back the arguments and stops.                       |
| Fold the analysis into `mantua_get_market`          | ✗       | Reads stay reads; the analysis is a reasoning artifact with disclaimers and a different audience.                                |

### Success criteria

- [x] `sports_intelligence` takes sport/game/team/market identifiers and returns analysis, probability, evidence, risk factors, market discrepancy and a suggested action — A-004, A-022
- [x] Sports + market + reasoning compose into a trade / fade / hold view with the next step being the simulation — A-005
- [x] "Should I buy the Falcons YES?" is answerable with zero user data — A-013
- [x] The agent's skills are declared in one list bound to typed tools; obsolete guidance removed — A-001
- [x] Every weight is shown; the estimate is labeled a reasoning aid, not a prediction

### Tests

- `server/src/lib/agent/sports-intelligence.test.ts` — the arithmetic adds up to the estimate, side flip, fade / hold thresholds, every risk, clamps, no-price case.
- `server/src/lib/sports/agent-sports-tools.test.ts` — `analyzeMarket` for "Falcons" over the fixture (side, market, evidence factors incl. injuries and live score, inputs, next step) and by providerEventId + outcomeIndex; not_found and validation.
