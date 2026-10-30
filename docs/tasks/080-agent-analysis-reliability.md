# Task 080 — Agent analysis reliability: the four P0 safeguards

Owner brief, 2026-10-30 ("Mantua Agent Analysis Reliability — Engineering
Goals"; prompt history `2026-10-30-agent-reliability.md`). Reference case:
Carolina at Green Bay, kickoff 2026-10-30 00:15 UTC (Thu 2026-10-29 20:15
EDT). The trigger: the agent told a trader to "watch Friday/Saturday
injury updates" for a Thursday night game.

The brief's seven goals map onto work already done and work done here:

| Goal                           | Status                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| G1 temporal correctness (P0)   | **Delivered here**                                                                    |
| G2 auditable attribution (P0)  | Reproduction done in Task 079 §1; **structured block delivered here**                 |
| G3 injury double counting (P0) | **Delivered here** (D-127)                                                            |
| G4 edge qualification (P0)     | **Delivered here**                                                                    |
| G5 statistical validation (P1) | Task 079 §7–8: reconstruction baseline and the grid; the ledger fills from 2026-10-29 |
| G6 better evidence (P1)        | Task 079 §8 names the inputs the catalog lacks; a sources decision for the owner      |
| G7 narrative faithfulness (P1) | Prompt rules **and** the post-turn narrative check delivered (second PR, same day)    |

## G1 — Temporal correctness

- `lib/sports/kickoff-context.ts`: `kickoffContext(startsAt, now, status)`
  → kickoff in UTC and Eastern (zone and calendar date spelled out), the
  Eastern weekday, `hoursToKickoff`, `phase` (pregame / live / final /
  postponed — authoritative status first, then the clock, so a delayed
  kickoff past its time reads as live, never pregame), and an
  `injuryReportNote` from the NFL calendar for that weekday (Thursday: the
  final report was Wednesday; inside 90 minutes: only inactives remain).
  Attached to every analysis as `timing`.
- `lib/agent/clock-prompt.ts`: the current time in UTC and Eastern, with
  the time and edge rules, stamped into every turn's system context for
  both the wallet agent and the read-only analyst. Before this neither
  prompt carried a clock at all.
- Tests: the reference Thursday case, UTC date rollover, the DST
  transition (EST vs EDT), delayed kickoff, game underway, every weekday.

## G2 — Attribution

`analysis.attribution`: `units: "bps"`, `baselineBps: 5000`, one entry per
term as applied, `sumBps`, `clampedTo` (null unless the 5–95% clamp
changed the number) and `finalBps`. Tests pin sum = final with no clamp
and the clamp case. The reference 5117 is pinned separately
(`sports-intelligence-audit.test.ts`).

## G3 — Incremental injury accounting (D-127)

Each injury now carries `reportedAt` and `gamesSince` (finals the team has
played since the report). An absence the team has already played
**three** finals without is long-standing: its effect is in the record
and form terms, so it is listed with `impactBps: 0` and the rationale
"already in the record", never counted again. This refines D-124: a
quarterback on injured reserve counts as out while recent and stops once
the record has absorbed him. `analysis.injuryContributions` lists every
player with status, report date, games since, impact and rationale; the
evidence line says how many of the open injuries were counted. Legacy
callers without `gamesSince` get the old rules unchanged. The model
version changes (`longStandingGames` joins `ESTIMATOR_WEIGHTS`).

This cannot be back-tested: the ledger has no injury history before
2026-10-29. It is a correctness rule, not a tuned weight, and it is
reported as such.

## G4 — Edge qualification

`lib/sports/edge-qualification.ts`: `qualifyEdge` → `no_market` (nothing
can be executed; a gap to the book is a candidate discrepancy only),
`none` (inside the threshold), `candidate` (a gap, with the blockers
named) or `qualified` — which needs a Mantua pool price under 15 minutes
old, depth ≥ 500 USDC, the model version's settled ledger record ≥ 30
with a Brier at or better than the reference, and a gap that covers the
fee when known. The sportsbook gap never qualifies anything. The analysis
tool reads the model version's track record from the ledger
(`calibrationStatus` on the tools db) and attaches `edge`; `bookLine` now
states `vigRemoved: true`, the method, and that no trade executes at it.
Today every game is `no_market` or `candidate` ("0 settled records for
this model version, needs 30"), which is the honest state.

## Not done, and why

- **G6 new data sources**: no new inputs were added; the brief forbids
  claiming data that is not there.
- The `suggestedAction` kinds are unchanged for the client; `edge` is the
  gate the narrative must obey.

## G7 — The narrative check (second PR, 2026-10-30)

`lib/agent/narrative-check.ts`: after a turn's prose is complete, every
percentage and bps figure in it is matched against the numbers in that
turn's tool results (display rounding allowed; a bps figure may also be
the gap between two reported bps values); "value / edge / mispriced"
language is a violation unless an analysis on the turn has
`edge.status: "qualified"` or the prose itself disclaims it; and a weekday
named with report/update language that falls after a pregame kickoff on
the turn is a violation (the reference defect: "Friday/Saturday injury
updates" for a Thursday game, now caught by test).

A failed check is never silent, and never blocks: streaming has already
put the prose in front of the user, so the generator appends one visible
caveat line naming each unverified claim, emits a `narrative_check` event
before `done`, counts it (`agent.narrative_check.failed`) and logs it.
Both the wallet agent and the read-only analyst run it. The stored
transcript keeps the caveat.

Known limits: dollar amounts, records ("4-3") and player names are not
checked; a figure the model computes correctly from two reported numbers
(other than a bps gap) will be flagged — the caveat says "could not be
verified", not "wrong".
