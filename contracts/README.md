# Mantua.AI — Contracts (Foundry)

The on-chain half of Mantua's NFL prediction markets: the Dynamic Market
Hook stack on Mantua's own Uniswap v4 PoolManager, the markets layer
(Market, MarketFactory, Resolver, MarketPoolBootstrap) and the vendored
ERC-8183 AgenticCommerce escrow. The single supported chain is **Arc
Mainnet (5042)**; USDC is the only currency.

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
# AgenticCommerce (ERC-8183): the vendored reference implementation + OZ upgradeable, both pinned
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.7.0 --no-git
forge install erc-8183/base-contracts@142e669 --no-git
```

## Layout

- `src/` — Mantua-owned source: the Dynamic Market Hook (`src/hooks/dynamic-market/`, fee model per D-105 in `MarketFeeFormula.sol` / `MarketFeeCalculator.sol` / `RiskPolicy.sol`) and the markets layer (`src/markets/`).
- `test/` — Foundry unit tests, invariants and the Arc fork E2E (`test/integration/`).
- `script/` — deployment scripts (see `script/README.md`) and `verify-hooks.ts` (on-chain bytecode/permission verification).
- `lib/` — Foundry-managed dependencies (gitignored).

## Deployments

The Dynamic Market stack is live on Arc Mainnet since 2026-09-30 and
AgenticCommerce since 2026-10-01; the runbooks and address records live
in `deploy/`. Run `npm run verify:hooks` from the repo root to refresh
the on-chain verification report at `docs/security/hook-deployments.md`.

## Security analysis

Hook and market source runs through the security analysis suite
(`script/security/run-slither.sh`) before any deployment. Findings are
logged in `docs/security/findings.md`; sign-off in
`docs/security/sign-off.md`.

## Common commands

```bash
forge build               # compile
forge test                # run unit tests
forge fmt                 # format
forge snapshot            # gas snapshots
forge coverage            # coverage report

# Arc Mainnet fork E2E (from contracts/; ARC_RPC_URL optional)
forge test --match-contract MarketLifecycleForkE2E -vv
```

See `docs/architecture.md` for how contracts integrate with `client/` and `server/`.
