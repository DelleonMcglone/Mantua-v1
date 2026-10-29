# Mantua-v1 — agent guide

Repo: `DelleonMcglone/Mantua-v1` ("Mantua.AI") — an agent-driven prediction market for
sports on **Base Mainnet (8453)**. Production app: mantua.ai.

## Stack

| Layer     | What                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo  | npm workspaces (`client`, `server`, `agent`), TypeScript, `"type": "module"`                                                        |
| Runtime   | Node `>=20.18.0` (`.nvmrc` pins 22; CI runs 20.x — both work; two `@circle-fin/*` packages warn `EBADENGINE` on Node 20, non-fatal) |
| Client    | Vite 8 + React 19 + Tailwind 4 SPA, Privy auth, viem, lightweight-charts (`client/`)                                                |
| Server    | Express 5 + TypeScript API on `tsx watch`, Drizzle ORM + PostgreSQL, Anthropic agent loop (`server/`)                               |
| Agent     | Standalone viem action kit (ERC-8004 / ERC-8183), isolated zod v3 + viem pin (`agent/`)                                             |
| Contracts | Foundry (Solidity): Dynamic Market Hook, market primitives, invariants (`contracts/`)                                               |
| Deploy    | Vercel (serverless via `api/index.ts` + esbuild bundle from `scripts/build-server.mjs`)                                             |

## Commands

```bash
npm install                     # root install (all workspaces); see Linux gotcha below
npm run dev                     # dev in ALL workspaces (client + server + agent)
npm run dev:server              # Express on :3001 only (tsx watch, reads server/.env)
npm run dev:client              # Vite on :5173 only (strictPort; /api proxied to :3001)
npm run typecheck               # tsc -b --noEmit, all workspaces
npm run lint                    # eslint . --max-warnings 0 (root)
npm test -w @mantua/server      # 228 unit tests (node:test via tsx)
npm test -w @mantua/client      # 84 unit tests
npm run db:migrate -w @mantua/server   # drizzle-kit migrate (needs DATABASE_URL)
cd contracts && forge test      # 204 Foundry tests (deps NOT vendored — see README)
```

## Services & env

- **PostgreSQL is required** (no Docker Compose in repo). `DATABASE_URL` e.g.
  `postgres://user:password@localhost:5432/mantua`. Migrations: `server/drizzle/migrations`
  (0000–0009, 29 tables).
- Copy `server/.env.example` → `server/.env` (required: `DATABASE_URL`, `PRIVY_APP_ID`,
  `PRIVY_APP_SECRET`; everything else optional with safe defaults) and
  `client/.env.example` → `client/.env` (`VITE_PRIVY_APP_ID` must be a real 25-char Privy
  app ID for the UI to pass Privy's loading gate; `VITE_MANTUA_NETWORK=mainnet`).
- `agent/.env` needs `AGENT_PRIVATE_KEY` (0x + 64 hex) only if you run the agent runtime.
- Ports: server `3001` (`PORT`), client `5173` (strictPort), Postgres `5432`.
- `.env*` is gitignored (except `.env.example`) — never commit secrets.

## Local verification (validated 2026-09-03)

1. Start Postgres, create role + db, run `db:migrate`, then `npm run dev`.
2. `curl http://localhost:3001/api/health` → `{"status":"ok","sportsSchema":true}`
   (checks DB + sports schema). Through the client: `curl http://localhost:5173/api/health`.
3. Public flows worth hitting: `/api/sports/slate?league=nfl` (live ESPN slate),
   `/api/pools` (DefiLlama Base pools), `/api/token-prices` (400 without `symbols`).
4. Browser: landing → **Launch App** → app shell (NFL/WNBA board) → league pages.
   Unauthenticated browsing works; login/wallet actions need a real Privy app ID.
5. Proof: `npm run typecheck` (0 errors), server tests 228/228, client tests 84/84,
   `npm run lint` clean — all against the lockfile-pinned tree.

### Linux dep gotcha (important)

`package-lock.json` was generated on darwin-arm64, so it records only macOS native
bindings. On Linux, `npm ci`/`npm install` never installs the linux-x64-gnu native
packages (npm optional-deps bug #4828) and `vite` fails with "Cannot find native binding".
Workaround after `npm ci` (lockfile stays untouched):

```bash
npm install --no-save @rolldown/binding-linux-x64-gnu@1.0.0-rc.17 \
  @esbuild/linux-x64@0.25.12 \
  @tailwindcss/oxide-linux-x64-gnu@4.2.4 \
  lightningcss-linux-x64-gnu@1.32.0
```

(First run of `rm -rf node_modules` may need `sudo` if the sandbox provisioned a
root-owned tree.)

## Codebase map

See [`codebase-map.md`](codebase-map.md) (folder-level, depth 2).

## Sandbox snapshot

- Snapshot template: `kpjd145d1v0xda52hr8n:default` (E2B)
- Built: `2026-09-03T16:18:45.323Z` from this onboarding session (computer
  `cmp_oEJym4UN`, live session `imrvfbeuitxw6xpleq4ue`)
- Contains: Postgres 17 cluster (migrated `mantua` db), Chromium + playwright-core
  (in `/tmp/pw`), installed deps incl. linux bindings, dev servers NOT running
  (restart with `npm run dev:server` / `npm run dev:client`).

## Conventions & docs

- Husky: pre-commit runs `lint-staged` (eslint --fix + prettier); pre-push runs
  `npm run typecheck`.
- Guidance docs: `README.md`, `docs/architecture.md` (living notes + decision log),
  `docs/specs/`, `docs/tasks/`, `docs/ops/incident-runbook.md`.
- Contracts deps (`contracts/lib/`: forge-std, v4-core/periphery, …) are gitignored
  and not pinned — `forge test` will not compile until they are vendored.
- Skills lockfile: `skills-lock.json` (reinstall via `npx skills experimental_install`).
