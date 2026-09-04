# 012 — CI baseline (B-012)

**Status:** ✅ green 2026-09-04 · **Branch:** `012-ci-baseline`

## Task

Lint + typecheck + tests green on the cleaned repo before any feature work.

## Overlap with PR #6

PR #6 (`ci: harden forge installs and retire obsolete tolerations`) landed on
main while this branch was open and already removed the `continue-on-error`
escapes from `ci.yml`. That half of the original task is done; this branch is
rebased on top of it and carries only what remained.

## What this branch changes

- **Node 22 via `node-version-file: .nvmrc`** — CI pinned `node-version: 20.x`
  while `.nvmrc` says 22 and `engines` requires >=20.18. CI was testing a
  different runtime than development.
- **Agent workspace covered.** `@mantua/agent` had no typecheck, lint, or test
  step in CI at all — its 17 tests never ran on a PR.
- **Typecheck and lint run once from the root** (`npm run typecheck` /
  `npm run lint` already fan out across all three workspaces) instead of
  per-workspace duplicates; tests stay per-workspace so the server's stub env
  vars stay scoped to the step that needs them.
- Job renamed `typecheck-lint-test` to match the order it actually runs in.

## Local verification (2026-09-04, rebased on main)

- `npm run typecheck` — 0 errors across client/server/agent
- `npm run lint` — clean at `--max-warnings 0`
- Tests: client 84/84, server 228/228 (stub env), agent 17/17

`contracts.yml` (Foundry) is out of scope — PR #6 owns it.
