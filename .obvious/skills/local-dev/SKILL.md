---
name: local-dev
description: Bring the Mantua-v1 monorepo to a fully working local dev environment (Postgres + Express + Vite) and verify it end-to-end. Validated 2026-09-03.
---

# local-dev — Mantua-v1 onboarding recipe

Everything below was executed and verified on the repo sandbox
(Debian 13, Node 20.20.2, no Docker) on 2026-09-03.

## 1. Dependencies

```bash
npm install            # or: npm ci  (lockfile-exact) — then see the Linux binding fix
```

**Linux native-binding fix (required).** The lockfile was generated on darwin-arm64,
so on linux-x64 `npm ci`/`npm install` never install the native optional deps
(npm bug 4828) and `vite` dies with "Cannot find native binding". After installing:

```bash
npm install --no-save \
  @rolldown/binding-linux-x64-gnu@1.0.0-rc.17 \
  @esbuild/linux-x64@0.25.12 \
  @tailwindcss/oxide-linux-x64-gnu@4.2.4 \
  lightningcss-linux-x64-gnu@1.32.0
```

This adds 6 packages and leaves `package-lock.json` untouched (verified with
`git status`). If `rm -rf node_modules` fails with EACCES, the provisioned tree is
root-owned — use `sudo rm -rf node_modules` (also for `client|server|agent/node_modules`).

## 2. PostgreSQL (required service)

No compose file in the repo; on Debian/Ubuntu:

```bash
sudo apt-get install -y postgresql
sudo pg_ctlcluster 17 main start
sudo -u postgres psql -c "CREATE ROLE mantua LOGIN PASSWORD 'mantua';"
sudo -u postgres createdb -O mantua mantua
```

## 3. Env files (all gitignored)

```bash
# server/.env
NODE_ENV=development
PORT=3001
DATABASE_URL=postgres://mantua:mantua@127.0.0.1:5432/mantua
PRIVY_APP_ID=local-dev-stub        # any non-empty string passes zod for local API dev
PRIVY_APP_SECRET=local-dev-stub

# client/.env
VITE_MANTUA_NETWORK=mainnet
VITE_PRIVY_APP_ID=                 # leave unset OR a real 25-char Privy app id (see note)
```

Privy notes (learned the hard way):

- The server-side zod schema only needs non-empty `PRIVY_APP_ID`/`PRIVY_APP_SECRET`
  (CI uses `ci-stub`) — the API runs fine with stubs.
- The client is different: Privy validates the app id is EXACTLY 25 chars and then
  fetches `GET https://auth.privy.io/api/v1/apps/<id>`. A fake-but-valid-format id
  gets HTTP 400 ("Invalid Privy app ID") and the app hangs on "Loading…" forever.
  With the var unset the app renders its designed "Configuration needed" screen.
- To screenshot the real UI without a Privy account, mock that one endpoint in the
  browser (Playwright `page.route`) with the wire-format JSON — required keys:
  `id`, `name`, `logo_url`, `allowlist_config{error_title,error_detail,cta_text,cta_link}`,
  `embedded_wallet_config{mode,require_user_owned_recovery_on_create,
user_owned_recovery_options,ethereum{create_on_login},solana{create_on_login}}`,
  `mfa_methods`, plus the flat flags (`enforce_wallet_uis`, `wallet_auth`,
  `solana_wallet_auth`, `passkeys_for_signup_enabled`, `disable_plus_emails`,
  `enabled_captcha_provider`, `captcha_site_key`, …). Working script kept at
  `/tmp/pw/mock-flow.mjs`; evidence in `/home/user/mantua-onboarding-evidence/`.

## 4. Migrate + run

```bash
DATABASE_URL=postgres://mantua:mantua@127.0.0.1:5432/mantua \
  npm run db:migrate -w @mantua/server     # applies 0000–0009 → 29 tables
npm run dev:server   # :3001
npm run dev:client   # :5173 (strictPort; /api → :3001)
```

## 5. Verify

```bash
curl http://localhost:3001/api/health     # {"status":"ok","sportsSchema":true}
curl 'http://localhost:5173/api/sports/slate?league=nfl'   # live ESPN slate via proxy
curl http://localhost:5173/api/pools      # live DefiLlama Base pools
npm run typecheck                        # 0 errors (all workspaces)
npm test -w @mantua/server               # 228/228 pass
npm test -w @mantua/client               # 84/84 pass
npm run lint                             # clean (eslint --max-warnings 0)
```

Browser flow (Chromium + playwright-core, `--no-sandbox`): landing → "Launch App" →
app shell (NFL/WNBA board sections) → NFL league page. All clicks worked, no app
page errors; 4 console errors came from the mocked Privy wallet hook (non-fatal).

## Gotchas hit during onboarding

- `pkill -f vite` / `pkill -f 'tsx watch'` kills your own shell (pattern matches the
  command line) — use `pkill -f '[v]ite'`-style bracket patterns.
- An earlier `npm install --no-save --no-package-lock <bindings>` re-resolved the
  WHOLE tree off-lockfile and drifted `@circle-fin/*` types (typecheck failure
  TS2375 in `server/src/lib/agent-bridge.ts`). Fix: `npm ci` (exact tree) then
  `npm install --no-save <bindings>` WITHOUT `--no-package-lock` — tree stays pinned.
- `npm test -w @mantua/server` picks up `server/.env` via `--env-file-if-exists`;
  a real migrated local DB is fine (CI uses stub values because it has no DB).
- Node 20 shows EBADENGINE warnings for `@circle-fin/developer-controlled-wallets`
  and `@circle-fin/smart-contract-platform` (want >=22). Non-fatal; repo engines
  floor is >=20.18.0 and CI runs 20.x.
- `forge test` cannot run until `contracts/lib/` deps are vendored (gitignored,
  not pinned as submodules — see README "Contracts").
- No seed script exists: DB data arrives via the sports-sync cron in production;
  locally the sports board renders live slates from ESPN and empty states by design.
