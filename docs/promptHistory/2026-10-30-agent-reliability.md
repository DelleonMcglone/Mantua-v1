# 2026-10-30 — Agent analysis reliability (P0 safeguards)

Owner prompts, in order:

1. Pasted the agent's "what a trader should watch" note for Carolina at
   Green Bay and asked: "Why does it say Second, Friday/Saturday injury
   updates for a Thursday night game?" — Answered: neither agent prompt
   carried a clock, and the analysis gave an ISO kickoff with no weekday
   or hours-to-kickoff, so the model fell back on the Sunday-game
   template week.
2. Pasted "Mantua Agent Analysis Reliability — Engineering Goals" (seven
   goals, four P0: temporal correctness, auditable attribution, injury
   double counting, edge qualification; P1: statistical validation, better
   evidence, narrative faithfulness; failure conditions; definition of
   done). Implicit ask: carry it out.

Delivered as Task 080 (`docs/tasks/080-agent-analysis-reliability.md`):
`kickoffContext` on every analysis and a clock with rules in every turn
(G1); `attribution` block (G2); `reportedAt`/`gamesSince` per injury
with the three-finals long-standing rule and per-player contributions
(G3, D-127); `qualifyEdge` with the ledger-backed calibration gate and an
honest `bookLine` (G4). G5 was covered by Task 079; G6 is a sources
decision; G7's structural validator is proposed next.

Owner: "ok, continue" / "Continue until complete" → G7: `narrative-check.ts`
runs after every turn of both agents; unverified figures, undisclaimed
edge language and post-kickoff weekdays get a visible caveat line, an
event, a counter and a log line. Task 080 complete except G6 (a data
sources decision).
