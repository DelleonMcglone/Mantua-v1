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
wallet. **Generate and register it yourself:**

```bash
node -e "console.log(require('@circle-fin/developer-controlled-wallets').generateEntitySecret())"
```

Then register the ciphertext and save the recovery file **outside the repo**:

```ts
import { registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";
import os from "node:os";
import path from "node:path";

await registerEntitySecretCiphertext({
  apiKey: process.env.CIRCLE_API_KEY!,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
  recoveryFileDownloadPath: path.join(os.homedir(), ".circle", "recovery-file.json"),
});
```

Docs: <https://developers.circle.com/wallets/dev-controlled/register-entity-secret>

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
4. Copy the policy id into `CIRCLE_GAS_STATION_POLICY_ID`.

The app never sends that id to Circle — the SDK sponsors SCA transactions
automatically once the policy exists. We record it so the code can assert
sponsorship was configured _deliberately_: without it, an agent wallet holding
no ETH fails as an opaque `timed out waiting for a tx hash`, which the wallet
audit flagged as indistinguishable from a network fault. Agent wallets are
provisioned as `SCA` (required for sponsorship, and correct on an L2).

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
confirms the wallet set is reachable and holds `BASE` wallets, and reports
whether Gas Station was recorded. Exit 0 = usable.

## What the code now enforces

- **Format validation** — API key must match `PREFIX:ID:SECRET`; entity secret
  must be 64 hex chars; wallet set id must be a UUID. A typo fails at boot
  with a named field instead of a confusing 401 at first agent use.
- **Coherence checks** (`circleCredentialIssues` in `server/src/env.ts`) —
  warn in dev, **hard-fail the boot in production**: API key without entity
  secret (or vice versa), missing wallet set id, missing Gas Station policy,
  or a TEST key in production.
- **Circle stays optional.** With no credentials at all the server boots
  normally and agent routes return 503 — the deliberate degradation path.
  The rules above only apply once credentials are present.
- **Runtime second line of defence** — `getAgentWalletSetId()` throws in
  production rather than implicitly creating a set.

## Follow-ups (not in this task)

- Wallet audit ship-blocker #1 stands: `circle/execute.ts` returns at Circle's
  `SENT` state, which is **not terminal** (`INITIATED → CLEARED → QUEUED →
SENT → CONFIRMED → COMPLETE`). A reverted transaction is still reported as
  success. `CIRCLE_WEBHOOK_KEY_ID` is scaffolded here because Circle
  recommends webhooks over polling for terminal state — wiring that endpoint
  is the actual fix.
- Idempotency keys (UUID v4) on mutating SDK calls, per Circle's guidance.
