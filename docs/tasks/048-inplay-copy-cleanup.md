# Task 048 — In-play copy and prompt cleanup

> Follows 045/046/047. D-103 made markets tradeable during the game; those
> lanes changed the behaviour. This lane clears the stale claims the old
> behaviour left behind, so nothing in the product, the model prompts, the
> ops templates, or the security docs asserts a rule that no longer exists.
>
> Copy, comments, and docs only — no behaviour, schema, or tool-contract
> changes. Gates: server typecheck ✅, lint ✅, **737 pass / 0 fail**
> (unchanged from main; one assertion retargeted, none added or removed).

## Functional-impact fixes

| Location                                                   | Said                                                                                                        | Says now                                                                                                                                                                                       | Why it mattered                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/src/lib/agent-chat.ts` (sports-betting prompt)     | "Only bet games whose slate status is scheduled AND whose start time is still in the future — betting freezes on-chain at kickoff, so skip in-progress and finished games…" | "Markets trade IN PLAY: buying and selling are open before AND during the game, so never pre-filter a slate down to games that have not started… the server refuses to build a trade on a closed market, or a BUY while a live game's feed has gone stale, and returns a typed error — relay it rather than skipping games in advance." | The live agent was **stricter than the product** (it would refuse the in-play trades D-103 exists to enable) and asserted a false on-chain fact. Also tells the model that selling is never feed-paused. |
| `server/src/lib/sports/strategy-parse.ts` (`previewLines`) | "Auto-disarms at kickoff freeze, resolution, or expiry."                                                     | "Stays armed through the game. Auto-disarms when the market closes (final game, or 12h after kickoff), on resolution, or at expiry."                                                            | User-facing confirmation copy describing the wrong disarm trigger — 046 moved the freeze signal to final-or-backstop. Test assertion retargeted to the new string.                  |

## Comment / doc corrections

| Location                                                            | Correction                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/lib/sports/strategies.ts` (module header)               | Header contradicted its own `ticksFromSlates`; now states the final-or-backstop rule.                                             |
| `server/src/routes/cron-strategies.ts` (docblock)                   | Same rule; the sweep's purpose restated for in-play.                                                                              |
| `server/src/lib/sports/strategy-engine.test.ts`                     | Stale test **name** only (body was already correct under 046).                                                                     |
| `README.md`                                                         | Three product descriptions of the trading window.                                                                                  |
| `docs/ops/incident-runbook.md`                                      | Canned **public** incident copy promised "markets freeze automatically at kickoff" — we would have published a false statement mid-incident. Degraded-data response and both templates now describe: in-play trading continues, buys pause on a stale live feed while sells stay open, finals still freeze, 12h backstop closes everything. |
| `docs/architecture.md`                                              | A security rationale arguing the position D-103 reversed — reframed as **superseded** (not wrong history) with a D-103 pointer.    |
| `docs/specs/dynamic-market-hook.md`                                 | In-scope list entry.                                                                                                               |
| `docs/security/sign-off.md`                                         | Inside the D-103 addendum: "the service disarm is more conservative than the contract" became false once 046 aligned the service. Corrected that sentence only — the signed original and **M-01's pending-acceptance status are untouched**. |
| `docs/security/dynamic-market-hook-review.md`                       | Dated superseded-by-045 banner; citations to the removed `FREEZE_LEAD` and a renamed test corrected. Original findings preserved.  |
| `docs/tasks/046-market-data-spine.md`                               | Caveats saying the on-chain hook still kickoff-freezes — marked resolved by 047 with a pointer rather than deleted.                |
| `docs/tasks/035-b9-execution-engine.md`, `docs/tasks/sports-pivot.md`, `deploy/dynamic-market/README.md` | Same stale rule found by this lane's own grep, beyond the 047 list.                                                                |

## Deliberately left

Every surviving "kickoff freeze" string is either historical record (the
"Found" column of the Phase-4 ledger, 047's before/after table, the markets
security review's description of what changed) or a **negative** instruction
(the runbook's "never promise a freeze at kickoff"). `resolution.ts:204`
explains why the sweep no longer fires at kickoff. None of these assert the
old rule as current.
