# Prompt History — Dynamic fee in every season (task 076)

**Date:** 2026-10-10
**Branch:** `claude/dazzling-rubin-yd4i7i`
**Task:** 076 — D-105 amendment: the dynamic fee applies in the regular season.

## Original prompt (owner)

> Ive decide to charge users. The same fee structure that wasnt going to
> start untii the playoffs will not start for the regualr season

## Refined prompt

Remove the regular-season exemption from the Dynamic Market Hook fee
model. D-105 set `REGULAR_SEASON_FEE = 0` and had
`MarketFeeCalculator.rate` return an all-zero breakdown for any pool whose
`playoffs` flag is false. Change the calculator so every pool pays the
same dynamic rate — `MIN_RATE` plus the four bounded premiums, clamped to
`[MIN_RATE, MAX_RATE]`, `MAX_RATE` when stale — and delete the constant.
Keep the rate band, the drivers, the ceiling, the formula and the
write-once `playoffs` registration flag unchanged; the flag becomes a
season label for telemetry and copy rather than a fee gate.

Carry the change through every mirror: the TypeScript fee library and
the combo planned-fee path on the server; the ticket, combo review, fee
explainer, docs page and Terms copy on the client; the fee-model page,
README, architecture notes, hook spec amendment, decision record, Terms
draft and deployment runbook. Replace the "regular season is free" tests
and invariants with "season does not change the rate". Record that the
live Arc Mainnet hook still carries the old gate and needs a redeploy.

Success: the criteria in `docs/tasks/076-regular-season-fees.md`.

## Why the refined prompt is better

The original says what changes in one sentence. It does not say which
of the two possible implementations is meant: flipping the registration
flag so every pool is registered "as a playoff pool" (works on the
deployed contract but makes the flag, every label and the telemetry
lie), or removing the gate from the calculator (the fee model actually
says what the owner wants; needs a redeploy). The refinement picks the
second, because the first is a fallback that leaves the on-chain truth
wrong, and spells out the boundary — the band, the drivers and the flag
stay — so the change is the removal of one rule rather than a new fee
model. It also names the deployment consequence so it cannot be missed.

## Process notes

- The o3 pre-review and Gemini code review (`llm`, `repomix`) are not
  installed in this session; the repository's own suites stand in.
- Foundry was fetched from the GitHub release archive so the Solidity
  suites could run here.
