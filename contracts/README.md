# Mantua AI v2 — Contracts (Foundry)

Hooks for Uniswap v4 pools. The single supported chain is Base Mainnet
(8453). Stable Protection and Dynamic Fee are pending mainnet
deployment + security sign-off (see `docs/security/sign-off.md`).

## Setup

```bash
# Install Foundry (one-time)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install deps (forge-std, OpenZeppelin, Uniswap v4 core/periphery, solmate)
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
forge install Uniswap/v4-core --no-git
forge install Uniswap/v4-periphery --no-git
forge install transmissions11/solmate --no-git

# Pull hook submodules (once per clone)
git submodule update --init --recursive
```

## Layout

- `src/` — Mantua-owned hook source (currently empty; vendored hooks live in `hooks/`).
- `hooks/` — git submodules pinned to specific commits of each external hook repo (see "Hooks" below).
- `test/` — Foundry tests, fork tests, fuzz harnesses (Phase 5 P5-024).
- `script/` — deployment + admin scripts. Includes `verify-hooks.ts` (P5-001 deployment verification).
- `lib/` — Foundry-managed dependencies (gitignored).

## Hooks

The MVP ships two hooks: Stable Protection (gated to the USDC/EURC
pair) and Dynamic Fee (any pair). Run `npm run verify:hooks` from the
repo root to refresh the on-chain verification report at
`docs/security/hook-deployments.md`.

| Hook | Source | Deployment | Address | Permissions |
| ---- | ------ | ---------- | ------- | ----------- |
| Stable Protection | [`stableprotection-hook@1282b89`](https://github.com/DelleonMcglone/stableprotection-hook/commit/1282b899b6f68d27e28d65194dc75661f23476af) | Base Mainnet (8453) — pending | env `STABLE_PROTECTION_HOOK_ADDRESS` | beforeInitialize, beforeSwap, afterSwap |
| Dynamic Fee | [`dynamic-fee@62710d6`](https://github.com/DelleonMcglone/dynamic-fee/commit/62710d6d9b403557b073a702b5546bc10e75c0c6) | Base Mainnet (8453) — pending | env `DYNAMIC_FEE_HOOK_ADDRESS` | beforeSwap, afterSwap |

**No hook is on Base Mainnet (8453) yet.** Deployment to mainnet, after
security sign-off, is the launch-gating step — see
`contracts/script/README.md` for the procedure. Once deployed, record
each address in its env var (server + this repo's tooling read them)
and re-run `npm run verify:hooks`.

## Security analysis

All hook source is run through the AI-assisted security analysis suite (Phase 5 P5-017 → P5-026) before mainnet deployment. Findings logged in `docs/security/findings.md`; sign-off in `docs/security/sign-off.md`. Re-run on every pinned-commit bump.

## Common commands

```bash
forge build               # compile
forge test                # run unit tests
forge fmt                 # format
forge snapshot            # gas snapshots
forge coverage            # coverage report

# Mainnet fork test (from project root)
forge test --fork-url $BASE_RPC_URL
```

See `docs/architecture.md` for how contracts integrate with `client/` and `server/`.
