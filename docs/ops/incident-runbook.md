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

**Stop all app writes and the money crons** (trades, arming, agent
actions — reads and the read-only crons stay up):

Engage with either lever; they compose (either one kills):

1. **Runtime (preferred — no redeploy):** in the Upstash console's data
   browser (or redis-cli), set the key `mantua:kill-switch` to `1`.
   Every server instance reads it within ~15s of its next request (the
   flag is cached 15s per instance). Disengage by setting it back to `0`
   or deleting the key — also effective without a deploy.
2. **Deploy-time baseline:** set `MANTUA_KILL_SWITCH=1` → redeploy.
   Static and one-directional: the runtime flag can engage on top of it
   but can never lift it.
3. While engaged (either lever), the three trading crons —
   `/api/cron/rebalance`, `/api/cron/intents`, `/api/cron/strategies` —
   refuse with `503 KILL_SWITCH_ACTIVE` alongside every write endpoint
   (C-020); the read-only crons (peg-sync, resolution, sports-sync) keep
   running. Note the strategies nuance: gated behind the global switch
   the strategies cron stops evaluating entirely (armed strategies stay
   armed but cannot fire), whereas `STRATEGIES_KILL_SWITCH=1` actively
   disarms every strategy with audit rows — prefer the narrower switch
   unless the app itself is the problem.
4. Verify: any write endpoint and any money cron must return
   `503 {"code":"KILL_SWITCH_ACTIVE"}` (for a cron: `curl -i
https://<host>/api/cron/rebalance` — expect the same 503 before any
   sweep runs).

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
   stale-serve flagged `delayed`, in-play markets keep trading but the
   server refuses to quote new BUYS on a live game while its feed is dark
   (P-012 — sells stay open), a game the feed already reported `final`
   still freezes (finals do not un-happen), and nothing settles. Settlement
   resumes by itself when fresh data returns (`resolution.test.ts` B10-004
   proves both halves).
2. If the outage outlasts a slate's grace window, boards show the delayed
   banner and finals stay unsettled — that is correct, not an incident.
   Positions sit in markets that are either frozen (final seen) or open
   with buys paused; nothing is at risk but latency, and no market can
   outlive its event — `startsAt + 12 h` closes it permissionlessly.
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

> Live game data is currently delayed. New buys on affected live games are
> paused while the feed is stale — you can still sell out of a position —
> and no market will settle until data is confirmed fresh. Every market
> closes automatically no later than 12 hours after its scheduled start.
> Funds are safe; trading and settlement resume automatically.

Template — settlement paused:

> We've paused automated settlement while we investigate <X>. Markets that
> have already closed stay closed and unresolved, and any market still in
> play keeps trading; resolutions will be posted with tx hashes when
> settlement resumes.

Rules: state what is closed, what is still trading, what is safe, what
happens next — never promise a freeze at kickoff, because trading runs
through the game (D-103); the guarantee we can make is the 12-hour
permissionless backstop. Link tx
hashes for anything already on-chain; never promise a resolution outcome
while data is unconfirmed.

## 5. Escalation quick reference

| Situation                                 | First move                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Strategy misbehaving                      | that strategy's Disarm button / endpoint                                                                |
| All strategies suspect                    | `STRATEGIES_KILL_SWITCH=1`                                                                              |
| Chat agent misbehaving                    | `AGENT_MODE=simulation` (previews only) or `AGENT_MODE=disabled` (503) + redeploy — §12                 |
| Bad data suspected                        | pull `MARKET_SIGNER_PRIVATE_KEY` (stops settlement)                                                     |
| Rate limit blocking legit users           | §7 — delete the `mantua:rl:*` key in Upstash                                                            |
| Signer key leaked                         | `setSigner` rotation + pull env key                                                                     |
| Operator key leaked                       | `proposeOperator`/`acceptOperator` two-step to a fresh key; rotate registry operator likewise           |
| Raw agent/ key (C-018)                    | §6 — sweep + retire; the key is burned in git history                                                   |
| App-wide emergency                        | runtime: `SET mantua:kill-switch 1` in Upstash (§1); or `MANTUA_KILL_SWITCH=1` + redeploy               |
| Users see "trading paused" / stale scores | §8 — `GET /api/status` says which rung of the ladder and why; live scores need the 5-min live-sync loop |

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
name you will recognize later — the same database also holds the C-020
runtime kill-switch flag, key `mantua:kill-switch` (§1). Half-configured
credentials stop the boot: the server refuses to start with exactly one
of the two set.

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

## 8. Platform status and the live stream (Phase 7, task 051)

**What users see.** A banner at the top of every app page whenever the
platform is not `live`: paused (kill switch), degraded (stale feed during a
game → new buys paused, sells open; stale data off-game; a provider
breaker open; RPC degraded), unreachable (the client could not reach the
API for ~50 s), or offline. Nothing is shown while live.

**Where it comes from.** `GET /api/status` (public, no auth, 5 s cache):

```bash
curl -s https://test-mantua.vercel.app/api/status | jq '{mode, reads, trading, killSwitch, message, feeds}'
```

`feeds.<league>.ageMs` is how old the last ingest is; `buysHalted` flips
when a league has a game in play and the feed is older than 15 minutes
(`IN_PLAY_FEED_MAX_AGE_MS`) — the same rule the trade route refuses under.

**Keeping the feed fresh.** Live scores are ingested by
`.github/workflows/live-sync.yml` every 5 minutes (`/api/cron/live-sync`,
cron-secret guarded, read-only for money — it keeps running under the
kill switch). If `feeds.*.ageMs` climbs during a game with the provider
healthy, check the Actions run first: a missing/mismatched `CRON_SECRET`
fails it with 401. `workflow_dispatch` runs it by hand.

**The stream.** `GET /api/stream/live` is the SSE feed the board holds
open. A 503 `STREAM_BUSY` means an instance is at its per-instance cap
(200) and clients are polling instead — expected under a spike, not an
incident by itself. Streams end themselves at 240 s and clients reconnect.

**Trades in doubt.** `GET /api/markets/trade/status?txHash=…` (auth)
returns the chain's verdict — confirmed / failed / pending / unknown — and
whether the fill is on record. The client asks this itself for anything it
signed and did not see confirm, across reloads.

## 9. RPC health, the shared cache, and the database pool (Phase 7, task 052)

**RPC.** `GET /api/status` → `rpc.healthy` / `rpc.detail`. `"primary … failing — on fallback"` means
the dedicated primary is rate-limited or down and reads are riding a
fallback: check the provider dashboard, then `BASE_RPC_FALLBACK_URLS`.
`"all N RPC hosts failing"` is a full outage of blockchain reads —
trades still settle on-chain, but balances, prices and the fill verifier
cannot read; the banner says so. **Production refuses a public host**
(`mainnet.base.org` etc.) in `BASE_RPC_URL`: the boot log prints the fix.
Never "fix" an RPC incident by pointing production at a public host —
that is the failure mode this rule exists for (TD-007).

**Shared cache.** Hot reads (slate, live odds, pools, metrics, positions)
are cached in the same Upstash database as the rate limiters under the
prefix `mantua:cache:`. A Redis outage degrades to per-instance caching —
reads keep working, look for `shared-cache:` warnings in the logs. To
force a refresh of one key: `DEL mantua:cache:<key>` (e.g.
`mantua:cache:positions:0x…` after a manual on-chain correction).

**Database pool.** Per instance: `DATABASE_POOL_MAX` (5) connections,
5 s to obtain one, 15 s per statement. Symptoms of exhaustion are
`connectionTimeoutMillis`-style errors in a burst: lower the per-instance
max before raising it (the ceiling is max × instances against Neon's
pooler), and check for a runaway query hitting the 15 s statement cap.

## 10. Metrics and alerts (Phase 7, task 053)

`GET /api/ops/alerts` (Bearer `CRON_SECRET`) is the on-call's first
`curl`: every condition worth a human, with severity and the runbook
section. `GET /api/ops/metrics` adds the numbers behind it. The alert
policy, the latency budgets and the log-drain recipe are in
`docs/ops/monitoring.md`; each live-sync tick also logs firing alerts as
structured `alert` events.

## 11. Circle SCA version pin (platform default changes 2026-09-14)

Circle's default smart-contract-account version for new Developer-Controlled
Wallets becomes `circle_6900_singleowner_v4` on 2026-09-14 (EntryPoint v0.7,
new address derivation). Existing wallets are untouched. Mantua **does**
depend on matching addresses across chains: a Gateway spend to another chain
defaults its recipient to the agent's own address (`unified-balance.ts`,
`recipientAddress ?? wallet.address`), so a wallet created later on that
chain must derive the same address or the funds land where no agent wallet
exists.

**What is pinned.** `getOrCreateAgentWallet` passes
`scaConfiguration.scaCore = CIRCLE_SCA_CORE` (default
`circle_6900_singleowner_v3`, matching the existing wallet set) on every
create. Do not change it for the current wallet set. To adopt v4, create a
NEW wallet set (`CIRCLE_WALLET_SET_ID`) and set `CIRCLE_SCA_CORE=…_v4`
together — never one without the other.

**Reproducing one existing address on a new chain** (e.g. Arc after D-112):
use Circle's Derive Wallet API (`client.deriveWallet`) against the existing
wallet id rather than Create Wallets; it reproduces the address regardless
of the platform default.

**If a spend already landed at an address with no wallet:** derive the
wallet for that chain from the Base wallet id — the funds are recoverable as
long as the derivation matches (v3). Check the Circle console for the
wallet's `scaCore` before deriving.

## 12. Agent execution modes (Phase 8, task 055, D-114)

`AGENT_MODE` is a server setting the model cannot read or change:

| Mode                     | Endpoint | Money-moving tools                                                                                                     |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `disabled`               | 503      | —                                                                                                                      |
| `simulation`             | 200      | Preview and simulate only; every execution is refused `SIMULATION_MODE`                                                |
| `user_testing` (default) | 200      | Preview → the user's own explicit "confirm" → server-minted single-use id → matching execution                         |
| `autonomous`             | 200      | As `user_testing` unless the user's policy has `auto_trade_enabled` — then a fresh executable simulation is the ticket |

In every mode the daily cap, the user's policy, the kill switch and the
contract allowlist are enforced in code underneath the gate. x402 paid
data (`call_paid_service`) is the agent's own pre-capped spend
(`X402_MAX_CALL_USD`, `X402_DAILY_CAP_USD`) and is not gated. To stop
the agent moving money without a redeploy, the runtime kill switch (§1)
already refuses every write; `AGENT_MODE` is the finer lever.

Confirmations live in Upstash under `mantua:agent:` (5 min TTL; previews
10 min). Deleting `mantua:agent:confirmation:<id>` voids one; deleting
`mantua:agent:preview:<sessionId>` clears a pending preview.

**Alert `agent_refusal_rate`** (task 061): more than half of gated
executions refused. Read the refusal codes in the alert detail:
`CONFIRMATION_REQUIRED` means the model is calling money tools without
the user's confirm (a prompt regression — compare the prompt's
confirmation protocol against the last deploy); `SIMULATION_DRIFT`
means previews are going stale before users confirm (check pool
activity and the 5-minute confirmation TTL); `CONFIRMATION_EXPIRED` /
`CONFIRMATION_INVALID` in volume suggests a client that re-sends or an
injection attempt (see the untrusted-data envelope's `suspiciousCount`
in the tool cards). No money moved in any refused case.

## 13. Launch-gate rehearsal — the kill-switch drill (task 067, G-016)

Run this on staging before the first dogfood day and once per quarter
after launch. It takes about ten minutes and leaves a log. Two people:
the operator (runs the levers) and the observer (times and records).

**Runner.** `npm run drill:kill-switch -w @mantua/server -- --target https://<host> --operator <name> --observer <name> --commit <sha>`
does steps 0, 2, 3, 5, 7 and the timing itself (`CRON_SECRET` in the
server `.env` enables step 5), prompts for the lever flips and the two
client observations, and prints the log below filled in. Exit code 0 is
PASS. The table is the manual fallback and the definition of each step.

**Preconditions.** Staging deployed from `main`; the observer has the
app open, signed in, with a ticket ready to confirm; the operator has
the Upstash console and `curl` against `https://<staging-host>`.

| Step | Operator                                                                                                                                                                   | Observer records                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 0    | `curl -s https://<host>/api/status` — confirm `"killSwitch": false`, `"trading": "open"`                                                                                   | T0, the status body                                                                                                        |
| 1    | Upstash: set `mantua:kill-switch` = `1`                                                                                                                                    | T1 (lever engaged)                                                                                                         |
| 2    | Every 5 s: `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/markets/trade/calldata -H 'content-type: application/json' -d '{}'` until it returns `503` | T2 = first 503, and T2 − T1 (target ≤ 20 s: the 15 s per-instance cache plus one request)                                  |
| 3    | `curl -s https://<host>/api/status` — expect `"killSwitch": true`, `"trading": "paused"`                                                                                   | T3; the status body                                                                                                        |
| 4    | —                                                                                                                                                                          | In the app: the ticket's Confirm reads "Trading paused" and is disabled without a reload (T4 ≤ T3 + 30 s, the status poll) |
| 5    | `curl -i https://<host>/api/cron/rebalance -H "authorization: Bearer <CRON_SECRET>"`                                                                                       | `503 {"code":"KILL_SWITCH_ACTIVE"}` before any sweep                                                                       |
| 6    | Upstash: set `mantua:kill-switch` = `0`                                                                                                                                    | T6 (lever released)                                                                                                        |
| 7    | Repeat step 2 until the calldata call stops returning 503 (it will return 400 on the empty body — that is the write path open again)                                       | T7, and T7 − T6                                                                                                            |
| 8    | —                                                                                                                                                                          | In the app: Confirm returns to "Confirm buy" without a reload                                                              |

**Pass** when every row's expectation held and T2 − T1 and T7 − T6 are
both under 20 s. Any other outcome is a finding: file it in
`docs/security/findings.md` with the step number and the observed body.

**Log template** (commit under `docs/ops/drills/YYYY-MM-DD-kill-switch.md`):

```
Date / host / commit:
Operator / observer:
T0 status:            T1 engaged:   T2 first 503:   (T2−T1 = __ s)
T3 status paused:     T4 client paused (no reload): yes/no
Step 5 cron 503:      yes/no
T6 released:          T7 write path open: (T7−T6 = __ s)
Step 8 client resumed (no reload): yes/no
Result: PASS / FAIL — findings filed: (ids)
```

The same table works for the deploy-time lever (`MANTUA_KILL_SWITCH=1`

- redeploy) with the deploy time in place of T1; expect T2 − T1 to be the
  deploy duration, and remember that lever cannot be lifted at runtime.
