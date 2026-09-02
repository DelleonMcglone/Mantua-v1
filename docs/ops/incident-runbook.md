# Incident Runbook (B10-009)

Who this is for: the operator on call. Every action here is either an env
flip, a `cast` command from the operator keystore, or a comms step. Keys
never leave the encrypted keystore; nothing here requires pasting a key.

Contract addresses live in `deploy/dynamic-market/README.md` and
`server/src/lib/markets-contracts.ts`. `<CRON_SECRET>` is in Vercel env.

## 1. Kill-switch activation

**Stop hedging strategies only** (they disarm on the next tick):

1. Vercel → env → set `STRATEGIES_KILL_SWITCH=1` → redeploy.
2. Verify: `GET /api/cron/strategies` shows `"killed": true` and every armed
   strategy transitions to `disarmed / kill-switch` (audit rows written).

**Stop all app writes** (trades, arming, agent actions — reads stay up):

1. Set `MANTUA_KILL_SWITCH=1` → redeploy.
2. Note: this also blocks user-initiated disarms through the API; the
   strategies engine still auto-disarms, so prefer the narrower switch
   unless the app itself is the problem.

**Stop settlement** (suspected bad data or signer compromise):

1. Remove `MARKET_SIGNER_PRIVATE_KEY` from Vercel env → redeploy. The
   resolution cron returns to a loud 503 dry run; nothing signs.
2. If the signer key is compromised: the operator rotates it on-chain —
   `cast send <RESOLVER> "setSigner(address)" <NEW_SIGNER> --account mantua-deployer`.
   Markets never need redeploying; that is what the Resolver contract is for.

## 2. Mis-resolution

**Prevention is the design**: delayed data never settles, disagreement never
tiebreaks, unknown never upgrades to final. If a wrong resolution still
lands:

1. **A resolution on-chain is final.** `Market.resolve` is one-way; there is
   no admin reversal, and the Terms say so. Do not attempt state surgery.
2. Immediately disable settlement (above) while the data path is diagnosed —
   one bad resolve usually means an upstream data problem that could repeat.
3. Scope it: the `resolutions` table has the source, signer, tx hash, and
   provider event id for every action. Cross-check against the provider's
   final and a second source.
4. Comms (see §4) with the tx hash and the exact discrepancy.
5. Remediation is a business decision (e.g. compensating affected redeemers
   from treasury via a straightforward USDC send); record the decision and
   payments in the audit log.
6. Post-mortem: which guard should have held it? (delayed flag, status
   mapping, corroboration). Fix the guard, add the regression test.

## 3. Provider outage / failover

Symptoms: `breakers` non-zero in `/api/cron/sports-sync` output; slates
flagged `delayed`; resolution cron holding everything.

1. **No action is usually required.** The system's designed response is:
   stale-serve flagged `delayed`, markets freeze on time, nothing settles.
   Settlement resumes by itself when fresh data returns (`resolution.test.ts`
   B10-004 proves both halves).
2. If the outage outlasts a slate's grace window, boards show the delayed
   banner and finals stay unsettled — that is correct, not an incident.
   Users' funds sit in frozen markets; nothing is at risk but latency.
3. Extended outage (> a few hours): manually verify finals from a second
   source; the operator may settle individual markets via the override —
   `cast send <RESOLVER> "resolve(bytes32,uint8)" <MARKET_ID> <0|1> --account mantua-deployer`
   — ONLY with two independent sources agreeing, per the corroboration
   doctrine. A void needs only one source saying postponed/cancelled.
4. Chronic ESPN instability → accelerate the DM-107 secondary vendor; the
   corroboration layer activates by configuration, not new code.

## 4. User comms

Channels: X (@Mantua_AI), Discord announcement channel.

Template — degraded data:

> Live game data is currently delayed. Markets freeze automatically at
> kickoff and no market will settle until data is confirmed fresh. Funds
> are safe; settlement resumes automatically.

Template — settlement paused:

> We've paused automated settlement while we investigate <X>. Open markets
> remain frozen; resolutions will be posted with tx hashes when settlement
> resumes.

Rules: state what is frozen, what is safe, what happens next; link tx
hashes for anything already on-chain; never promise a resolution outcome
while data is unconfirmed.

## 5. Escalation quick reference

| Situation              | First move                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Strategy misbehaving   | that strategy's Disarm button / endpoint                                                      |
| All strategies suspect | `STRATEGIES_KILL_SWITCH=1`                                                                    |
| Bad data suspected     | pull `MARKET_SIGNER_PRIVATE_KEY` (stops settlement)                                           |
| Signer key leaked      | `setSigner` rotation + pull env key                                                           |
| Operator key leaked    | `proposeOperator`/`acceptOperator` two-step to a fresh key; rotate registry operator likewise |
| App-wide emergency     | `MANTUA_KILL_SWITCH=1`                                                                        |
