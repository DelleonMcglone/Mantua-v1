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

| Situation                       | First move                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Strategy misbehaving            | that strategy's Disarm button / endpoint                                                      |
| All strategies suspect          | `STRATEGIES_KILL_SWITCH=1`                                                                    |
| Bad data suspected              | pull `MARKET_SIGNER_PRIVATE_KEY` (stops settlement)                                           |
| Rate limit blocking legit users | §7 — delete the `mantua:rl:*` key in Upstash                                                  |
| Signer key leaked               | `setSigner` rotation + pull env key                                                           |
| Operator key leaked             | `proposeOperator`/`acceptOperator` two-step to a fresh key; rotate registry operator likewise |
| Raw agent/ key (C-018)          | §6 — sweep + retire; the key is burned in git history                                         |
| App-wide emergency              | `MANTUA_KILL_SWITCH=1`                                                                        |

## 6. Raw agent/ key — MANDATORY revocation (C-018)

The standalone `agent/` workspace (deleted in C-018) signed with a raw
`AGENT_PRIVATE_KEY` EOA outside every safety rail. Its own funding
runbook instructed operators to fund that address with real ETH + USDC
on mainnet.

**The key is burned in git history.** Deleting the directory does not
un-leak it: the full workspace — including the funding runbook, the
`AGENT_PRIVATE_KEY` env slot, and `agent/.env.example` — remains
recoverable from git history (introduced in `ef37ef9`). Anyone with read
access to this repository can reconstruct the entire setup. History is
not being rewritten; treat the exposure as permanent.

**MANDATORY: any private key that was ever generated for, loaded into,
or funded in the `agent/` workspace must be treated as permanently
compromised.** Revocation is an operator action, not a code change. For
an EOA the address is the key — there is no on-chain rotation. The
revocation procedure is sweep and retire:

1. **Sweep.** If the address ever held funds, move every remaining ETH
   and USDC balance to a fresh, never-before-used operator address.
   Verify the sweep on-chain via the explorer before continuing.
2. **Revoke approvals.** If any ERC-20 allowances remain active from
   that address to any spender contract, revoke them before abandoning
   the key (the sweep in step 1 does not clear approvals).
3. **Retire the address.** Never fund it, never sign with it again, and
   remove it from any allowlist, monitoring, or funding script.
4. **Purge copies.** Remove the key material from every store it
   touched — Vercel env, CI secrets, local `.env` files.
5. **Monitor.** Watch the retired address on the explorer. Any outbound
   transfer not made in step 1 means someone else holds the key: treat
   as an incident (§4 comms, postmortem within 48h).

Circle-managed agent wallets are unaffected — they never shared key
material with this workspace. If the operator certifies no key was ever
generated or funded for it, record that determination in the postmortem
log; the default assumption is that a key existed.

## 7. Shared rate-limit store (C-021)

API rate limits (free-analyst quota, auth, oracle, trades) are shared
across all server instances via Upstash Redis. A lambda recycle no
longer resets anyone's counters: the limits live in Redis keys
`mantua:rl:*` with per-window TTLs, not in instance memory.

**Configuration.** Provision a REST database in the Upstash console
(Vercel → Storage → Upstash also works and fills both values in), then
set both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in
Vercel env, in the region close to the lambdas (e.g. `iad1`). Pick a
name you will recognize later — the same database is where the C-020
kill-switch state will live. Half-configured credentials stop the boot:
the server refuses to start with exactly one of the two set.

**Fallback behavior.** With neither variable set, the limiters fall
back to the old per-instance memory store: limits reset on every lambda
recycle (the pre-C-021 behavior) — treat this as unprotected. With the
variables set and Redis unreachable, requests pass **uncounted** —
limits fail open for availability, and every store error is logged with
the `[rate-limit]` prefix. A Redis outage degrades protection, not
uptime; watch for that log prefix rather than page on 5xx.

**Verification.** Hit any limited endpoint five times from one IP; the
`RateLimit` response header (draft-7 combined form,
`limit=N, remaining=K, reset=S`) counts down across restarts and
different instances. In the Upstash console's data browser, `mantua:rl:*`
keys appear during traffic and expire on their own.

**Resetting a blocked client.** Rate-limit state is disposable. If an
incident or a shared office NAT blocks legitimate users, delete the
offending `mantua:rl:*` key in the Upstash data browser — no redeploy
needed. Keys untouched inside one window expire by themselves.

**Sizing.** Counters are small strings with TTLs bounded by the window
(15 min worst case). The free Upstash tier handles this write load;
there is nothing to tune unless request volume grows by orders of
magnitude.
