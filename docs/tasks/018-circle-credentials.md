# 018 — Circle credentials: Wallets, USDC flows, Paymaster (B-018)

**Status:** 🟡 scaffolding shipped, credentials pending operator action
**Branch:** `018-circle-credentials`

## Split of work

Provisioning a Circle account and generating API credentials **cannot be
automated on the developer's behalf** — it requires creating an account,
authenticating, and generating key material. Circle's own guidance is
explicit about the entity secret: _"NEVER register an entity secret on behalf
of the user on mainnet — they must generate, register, and store it
themselves."_ That is also the right security boundary: the entity secret is
full custody of every agent wallet, and it should never transit a tool, a
transcript, or a log.

So this task ships everything that _surrounds_ the credentials — schema,
validation, safe storage, failure modes, verification — and hands the console
work to the operator as the runbook below.

| Part                                            | Owner        | Status     |
| ----------------------------------------------- | ------------ | ---------- |
| Env schema, format validation, boot-time checks | code         | ✅ done    |
| `.env.example`, `.gitignore` hardening          | code         | ✅ done    |
| Wallet-set hard-fail in production              | code         | ✅ done    |
| Credential preflight script                     | code         | ✅ done    |
| Circle account + API key + entity secret        | **operator** | ⬜ pending |
| Wallet set + Gas Station policy                 | **operator** | ⬜ pending |

## Operator runbook

### 1. Account and API key (Wallets)

1. Create/sign in to the Circle Developer Console: <https://console.circle.com>.
2. Complete organization verification if prompted — mainnet (`LIVE`) keys are
   gated behind it; testnet works without.
3. **Create an API key** → copy it once (it is not shown again). Format is
   `PREFIX:ID:SECRET`.
   - Use a **`LIVE_API_KEY`** for Base Mainnet. A `TEST_API_KEY` silently puts
     the agent on testnet while the rest of the app is on 8453 — boot
     validation and the preflight both flag this.
   - Scope it to the minimum the app needs (Wallets read/write); keep separate
     keys per environment so staging can be revoked independently.

### 2. Entity secret (custody root)

The entity secret is a 32-byte key that secures every developer-controlled
wallet. **Generate and register it yourself** — two scripts, in this order:

```bash
npm run circle:generate-secret -w @mantua/server
```

Prints a fresh 64-hex-char secret to your terminal only — nothing is written
to disk or sent anywhere. Copy it into `server/.env`:

```
CIRCLE_ENTITY_SECRET=<the printed value>
```

Then register it (needs `CIRCLE_API_KEY` in `.env` too):

```bash
npm run circle:register-secret -w @mantua/server
```

This registers the ciphertext with Circle and writes the recovery file to
`~/.circle/mantua-recovery-file.dat` (mode 600) — deliberately **outside the
repo**, since a committed recovery file is the same disclosure as the secret.
Override the location with `CIRCLE_RECOVERY_FILE_PATH`.

**Registration is not idempotent.** Re-running rotates the entity secret and
invalidates the previous one, orphaning every wallet created under it — so
the script refuses to overwrite an existing recovery file unless you pass
`--force`.

Docs: <https://developers.circle.com/wallets/dev-controlled/register-entity-secret>

> Implementation note: the SDK's `generateEntitySecret()` returns `void` — it
> prints the value itself, so there is nothing to capture. And because the SDK
> is CJS while this workspace is ESM, its named exports resolve under
> `default`; both scripts unwrap that the same way `lib/circle/client.ts`
> does. A static `import { generateEntitySecret }` fails at runtime.

- Store the secret in a secrets manager (1Password, Vercel env, AWS Secrets
  Manager) — never in the repo, never in a chat.
- Store the recovery file offline. **Losing the entity secret without it means
  every agent wallet is permanently unrecoverable.**
- `.gitignore` already blocks `recovery-file.json`, `*-recovery-file.json`,
  the legacy `.dat` names, `*.pem`, and every `.env*` except the examples.

### 3. Wallet set

Create one wallet set for agent wallets and **pin its id**:

```bash
# after CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET are in server/.env
npm run circle:preflight -w @mantua/server   # dev: creates + prints one if absent
```

Or create it in the Console and copy the id. Set `CIRCLE_WALLET_SET_ID`.

**Why this is mandatory in production:** the id is cached per process. Unset,
every serverless cold start mints a _new_ wallet set — users' wallets scatter
across orphaned sets and, because Gas Station policies bind to a specific set,
those wallets are unsponsored. The server now refuses to boot in production
rather than do this silently.

### 4. Gas Station (paymaster)

**There is no paymaster API credential for Developer-Controlled Wallets.**
Sponsorship is console-side policy, not a key:

1. Console → **Gas Station** → create a policy.
2. Scope it to **Base (mainnet)** and to the wallet set from step 3.
3. Fund / configure the spend limits per your risk appetite.
4. **Activate the policy** and make it the **default policy for Base** —
   transactions use only the network's default policy; an inactive or
   non-default policy sponsors nothing (and deactivating one later stops
   sponsorship the same way).
5. Copy the policy id into `CIRCLE_GAS_STATION_POLICY_ID`.

Sponsorship itself is applied by Circle automatically once that policy exists
— the DCW transaction API has no sponsorship argument. The recorded id is
consumed two ways (C-017): production refuses to create a transaction that
Gas Station cannot sponsor, and every transaction carries the id as Circle's
`refId`. Circle's console lists sponsored transactions per policy, so that
`gas-station:<id>` provenance is the operator's closed loop: if a transaction
created by the server does not appear under the recorded policy, the recorded
id is not the one actually sponsoring the code. Without a recorded id, an
agent wallet holding no ETH fails as an opaque `timed out waiting for a tx
hash`, which the wallet audit flagged as indistinguishable from a network
fault. Agent wallets are provisioned as `SCA` (required for sponsorship, and
correct on an L2).

### 5. USDC flows

No extra credentials. USDC on Base Mainnet is the canonical
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6dp) already in
`server/src/lib/tokens.ts`; Gateway/CCTP flows authenticate with the same
Wallets API key. Fund the agent wallet with real USDC — there are no faucets
on mainnet.

### 6. Where the values go

| Environment | How                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Local       | `server/.env` (gitignored; copy the shape from `server/.env.example`)                                |
| Vercel      | `vercel env add CIRCLE_API_KEY production` etc., or the dashboard → Settings → Environment Variables |

Never paste credentials into source, commit messages, issues, or a chat
session. If one is exposed, rotate it in the Console immediately — and for the
entity secret, assume every wallet under it is compromised.

### 7. Verify

```bash
npm run circle:preflight -w @mantua/server
```

Checks credential shapes (never printing values), authenticates to Circle,
confirms the wallet set is reachable and holds `BASE` wallets, and verifies
the Gas Station policy's live dependencies (wallet set reachable, `BASE`
wallets present). Circle exposes no policy-read API — active/default status
is console-only — so the script prints that confirmation step explicitly
alongside the `refId` provenance note. Exit 0 = usable.

## What the code now enforces

- **Format validation** — API key must match `PREFIX:ID:SECRET`; entity secret
  must be 64 hex chars; wallet set id and Gas Station policy id must be UUIDs.
  A typo fails at boot with a named field instead of a confusing 401 at first
  agent use.
- **Coherence checks** (`circleCredentialIssues` in `server/src/env.ts`) —
  warn in dev, **hard-fail the boot in production**: API key without entity
  secret (or vice versa), missing wallet set id, missing Gas Station policy,
  or a TEST key in production.
- **Circle stays optional.** With no credentials at all the server boots
  normally and agent routes return 503 — the deliberate degradation path.
  The rules above only apply once credentials are present.
- **Runtime second line of defence** — `getAgentWalletSetId()` throws in
  production rather than implicitly creating a set, and
  `createAgentContractExecution` refuses in production when the Gas Station
  policy id went missing after boot (C-017), stamping `gas-station:<policy
id>` as the Circle `refId` on every transaction otherwise.

## Follow-ups (not in this task)

- Wallet audit ship-blocker #1 stands: `circle/execute.ts` returns at Circle's
  `SENT` state, which is **not terminal** (`INITIATED → CLEARED → QUEUED →
SENT → CONFIRMED → COMPLETE`). A reverted transaction is still reported as
  success. `CIRCLE_WEBHOOK_KEY_ID` is scaffolded here because Circle
  recommends webhooks over polling for terminal state — wiring that endpoint
  is the actual fix.
- Idempotency keys (UUID v4) on mutating SDK calls, per Circle's guidance.
