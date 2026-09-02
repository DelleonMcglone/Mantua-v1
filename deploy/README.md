# Deploy scripts and runbooks

Standalone deploy scripts and records that live outside the main
Foundry project in `contracts/`. Everything here targets **Base
Mainnet (8453)** — the single chain Mantua supports.

| Directory | Contents |
|---|---|
| [`dynamic-market/`](dynamic-market/README.md) | Runbook + records for the Dynamic Market Hook stack (dedicated PoolManager, MarketStateRegistry, mined hook, markets periphery). The script itself lives at `contracts/script/DeployDynamicMarket.s.sol`. |
| [`agentic-commerce-base/`](agentic-commerce-base/README.md) | ERC-8183 AgenticCommerce escrow (UUPS implementation + ERC1967 proxy, Base USDC as payment token). |

Conventions shared by the scripts:

- Build/run with **`--via-ir --optimizer-runs 200`** where PositionManager
  is involved (via-ir is required; runs=200 keeps it + PositionDescriptor
  under the EIP-170 24,576-byte limit). Both are the project defaults in
  `contracts/foundry.toml`.
- `run()` returns nothing on purpose — a returning `run()` breaks
  `--broadcast` serialization.
- Keep deployer keys in an encrypted keystore (`cast wallet import ...
  --interactive`), never in a plaintext env var or command line.
- Verify sources on [BaseScan](https://basescan.org) with
  `BASESCAN_API_KEY` (the `[etherscan] base` entry in
  `contracts/foundry.toml`).

After each deploy, paste the printed addresses back so they can be wired
into the app's env-driven contract registry (no addresses are hard-coded
until a mainnet deployment exists — see `docs/tasks/v2-roadmap.md`).
