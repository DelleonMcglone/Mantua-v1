# Mantua incident runbook

Operational reference for kill-switch activation, rollback, and user
communications during a Mantua incident. Keep this short — every minute
spent reading is a minute the user isn't being helped.

If you're on call and an incident is firing, the order is:

1. **Stop the bleed** — kill switch
2. **Diagnose** — server log + on-chain receipts
3. **Communicate** — user-facing status post
4. **Roll back** — code or config
5. **Postmortem** — within 48h

---

## 1. Stop the bleed (kill switch)

Mantua has a server-side kill switch driven by an env var. When active,
every write endpoint (swap, liquidity add/remove, pool create, agent
swap/send/liquidity) returns `503 KILL_SWITCH_ACTIVE` before any
calldata is built or any chain state is touched.

**Activate (production):**

```bash
# Railway / Fly.io — set the env var, server picks it up on next
# request (no restart needed for the middleware itself, but a deploy
# is the cleanest reload of `env.ts`'s zod parse).
MANTUA_KILL_SWITCH=1
```

The middleware lives in [`server/src/middleware/kill-switch.ts`](../server/src/middleware/kill-switch.ts);
the env binding is in [`server/src/env.ts`](../server/src/env.ts) (parsed via zod, defaults to `0`).

**Verify the switch is active:**

```bash
curl -i https://api.mantua.example.com/api/quote \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"USDC","tokenOut":"EURC","amountRaw":"1000000"}'
# expect: 503 + {"code":"KILL_SWITCH_ACTIVE"}
```

**Read endpoints stay open** — the user can still see balances, pool
data, and analyze topics. Writes are the only thing gated. This is
intentional: a hot incident shouldn't blank out the UI.

**Deactivate** — flip the env var back to `0`, redeploy.

---

## 2. Diagnose

The server log goes to stdout in production (Railway / Fly stream it).
Locally it tees to `/private/tmp/mantua-server.log`. Useful greps:

```bash
# Last 100 errors
tail -1000 /private/tmp/mantua-server.log | grep -i 'error\|fail' | tail -100

# Stuck transactions (PostgreSQL ECONNREFUSED, RPC timeouts)
tail -1000 /private/tmp/mantua-server.log | grep -E 'ECONNREFUSED|timeout|503'

# Specific user — replace with the wallet address
tail -10000 /private/tmp/mantua-server.log | grep '0xbaac'
```

**On-chain incidents (Base Mainnet):**

- Mantua hooks (Stable Protection, gated to USDC/EURC; Dynamic Fee, any
  pair): mainnet deployment pending — addresses come from the
  `STABLE_PROTECTION_HOOK_ADDRESS` / `DYNAMIC_FEE_HOOK_ADDRESS` env
  overrides once deployed. See
  `docs/security/hook-deployments.md`.
- v4 PoolManager (Base): `0x498581fF718922c3f8e6A244956aF099B2652b2b`.
- v4 Quoter (Base): `0x0d5e0F971ED27FBfF6c2837bf31316121532048D`.
- v4 StateView (Base): `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71`.
- BaseScan: `https://basescan.org/address/<addr>`.

For mid-incident on-chain spelunking, write a one-off `tsx` script
under `server/` that imports `baseRpcClient` from
[`server/src/lib/rpc-client.ts`](../server/src/lib/rpc-client.ts) and
runs the read you need. The repo has precedent for this in earlier
debug sessions (search git log for "sim-pool-init.mjs").

---

## 3. Communicate

User-facing status post format (Twitter/X + status page):

> **\[INVESTIGATING / IDENTIFIED / RESOLVED\]** Mantua is currently
> experiencing **\[brief one-line description\]**. Writes
> (swaps, deposits, withdrawals) are
> \[paused / degraded / unaffected\]. Read-only views remain available.
> We'll update this thread every \[15 / 30 / 60\] minutes until resolved.

Key principles:
- **Lead with status word** in brackets. Subscribers filter on it.
- **Always disclose write status** — that's the question users have.
- **Set update cadence**. If you say "every 15 minutes", post every
  15 minutes even if nothing has changed; "still investigating" is
  more reassuring than radio silence.
- **No speculation about cause** until you've isolated it.

For a critical incident (funds at risk, contract bug, etc.), also:
- DM major LPs directly (positions > $100k, listed in Linear "VIPs")
- Post in #incidents Slack channel with the full diagnosis chain

---

## 4. Roll back

**Code rollback** — every PR ships behind a normal merge commit. Revert via:

```bash
git revert <commit-sha>
git push origin main
# CI runs, deploy goes out automatically
```

**Config rollback** — env vars roll back per-platform:

- Railway: redeploy from Activity tab → "Restore" on the prior deployment
- Vercel: redeploy from Deployments → "Promote to Production" on the prior good build

**Database rollback** — if a migration is the cause:

```bash
# Drizzle doesn't have a built-in down migration. The patterns we use:
# 1. Pure additive (new table / new column nullable) → safe to leave; no rollback needed.
# 2. Renames / type changes → ship a new migration that reverses the change.
# 3. Drops → don't drop in a hot migration. Mark deprecated, drop later.
```

If a `record` write started 500'ing post-migration, the most likely
fix is a new migration that adds back the column it expected, NOT a
rollback. Drizzle migrations are forward-only by design.

---

## 5. Postmortem

Within 48 hours of resolution, write a postmortem in
`docs/postmortems/YYYY-MM-DD-<slug>.md`. Template:

```markdown
# YYYY-MM-DD — <one-line description>

**Status:** Resolved
**Severity:** S1 / S2 / S3
**User impact window:** ISO timestamps + duration
**Author:** <on-call>

## Timeline (UTC)
- HH:MM — first signal
- HH:MM — kill switch activated
- HH:MM — root cause identified
- HH:MM — fix deployed
- HH:MM — kill switch lifted

## What happened
2-3 paragraphs. Plain language.

## Root cause
The actual technical cause. Files, commits, env vars, etc.

## What worked
- The kill switch fired in <X> seconds
- BaseScan / on-chain readbacks were accurate
- ...

## What didn't
- Alert fired N minutes after first user report
- ...

## Action items
| Item | Owner | Due |
| ---- | ----- | --- |
| Add alert for X | @who | YYYY-MM-DD |
```

Postmortems land in main as their own PR; reviewed by everyone on
on-call rotation.

---

## Reference

- Kill switch code: [`server/src/middleware/kill-switch.ts`](../server/src/middleware/kill-switch.ts)
- Env binding: [`server/src/env.ts`](../server/src/env.ts) (`MANTUA_KILL_SWITCH`)
- Hook deployments: [`docs/security/hook-deployments.md`](./security/hook-deployments.md)
- Tech debt: [`docs/tech-debt.md`](./tech-debt.md)
