# Deployment scripts

All scripts target **Arc Mainnet (5042)**. Keep deployer keys in an
encrypted keystore (`cast wallet import … --interactive`), never in a
plaintext env var or on the command line; every deploy is a manual,
attended operation.

- `DeployDynamicMarket.s.sol` — the Dynamic Market Hook stack (dedicated
  PoolManager + MarketStateRegistry + mined hook). Runbook and address
  record: `deploy/dynamic-market/README.md`.
- `DeployMarketPeriphery.s.sol` — v4 periphery for the dedicated
  dynamic-market PoolManager (pass its address via `POOL_MANAGER`).
- `DeployMarkets.s.sol` — Resolver + MarketFactory against Arc USDC.
- `DeployAgenticCommerce.s.sol` — the vendored ERC-8183 escrow behind a
  UUPS proxy. Runbook and address record: `deploy/agentic-commerce/README.md`.
- `verify-hooks.ts` — on-chain bytecode/permission verification report
  (`npm run verify:hooks` from the repo root, with
  `DYNAMIC_MARKET_HOOK_ADDRESS` set).
- `security/run-slither.sh` — Slither baseline over the first-party
  contracts, output under `docs/security/slither/`.
