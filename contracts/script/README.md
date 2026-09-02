# Foundry scripts

## DeployStableProtection.s.sol

Deploys the Stable Protection hook to Base Mainnet (8453). The script is
shipped here; **the on-chain deploy is a manual run** — see procedure
below. Deployment is gated on security sign-off
(`docs/security/sign-off.md`).

### Why a repo-local script?

The upstream `hooks/stable-protection/script/Deploy.s.sol` (vendored
submodule) hardcodes another chain's constants (PoolManager, test
routers, mock-stablecoin pool setup). Re-targeting Base Mainnet means
changing the PoolManager and skipping the mock/liquidity/test-swap path
(the canonical Base USDC/EURC pool is created separately via the client
pool-creation flow).

Rather than fork the submodule, this script imports the hook source
through the `stable-protection/` remapping (see `remappings.txt`) and
parameterizes the PoolManager via env vars.

### Prerequisites

1. **Submodules initialized.** From the repo root:
   ```bash
   git submodule update --init --recursive
   ```
   Confirm `contracts/hooks/stable-protection/src/StableProtectionHook.sol` exists.

2. **Foundry deps installed** (one-time, in `contracts/`):
   ```bash
   cd contracts
   forge install foundry-rs/forge-std --no-git
   forge install OpenZeppelin/openzeppelin-contracts --no-git
   forge install Uniswap/v4-core --no-git
   forge install Uniswap/v4-periphery --no-git
   forge install transmissions11/solmate --no-git
   ```

3. **Env vars set** (in `contracts/.env` or your shell):
   - `BASE_RPC_URL` — e.g. `https://mainnet.base.org`
   - `PRIVATE_KEY` — deployer's hex private key (no `0x` prefix expected by `vm.envUint`)
   - `BASESCAN_API_KEY` — for `--verify` on BaseScan
   - `POOL_MANAGER` (optional override) — defaults to the canonical Base
     Mainnet v4 PoolManager
     `0x498581fF718922c3f8e6A244956aF099B2652b2b` (per
     [developers.uniswap.org/contracts/v4/deployments](https://developers.uniswap.org/contracts/v4/deployments))

4. **Deployer wallet has Base ETH.** Bridge or transfer roughly
   0.005–0.01 ETH to the deployer address on Base Mainnet for gas.

### Run

From `contracts/`:

```bash
forge script script/DeployStableProtection.s.sol \
  --rpc-url base \
  --broadcast \
  --verify \
  -vvvv
```

The script prints the mined hook address before broadcasting and the
deployed address after, plus the lower-14-bit permission flags for
sanity-checking against `Hooks.sol`.

### After a successful run

1. Set `STABLE_PROTECTION_HOOK_ADDRESS` in the server env (and the
   `VITE_*` client equivalent if the client reads it directly).
2. Update `docs/security/hook-deployments.md` via
   `npm run verify:hooks` (with the env var set) — Stable Protection's
   row should now show Base (8453) ✅ Deployed.
3. Update `docs/security/sign-off.md` to mark the bytecode-verified
   column ✅ for Stable Protection on Base Mainnet.
4. Update the `contracts/README.md` hook table with the deployed address.

### Failure modes (stop-and-ask triggers)

- `PoolManager has no bytecode on this chain` — wrong RPC or wrong
  POOL_MANAGER address. Re-verify against Uniswap docs page.
- `Mined and deployed addresses diverged` — CREATE2 reverted, usually
  because the salt search exceeded the iteration budget or the hook
  flags don't match the contract's `getHookPermissions()`.
- BaseScan verification fails (source mismatch) — the submodule's
  `solc` version (0.8.26) differs from the monorepo's foundry config
  (0.8.27); compile metadata won't match. Resolve by aligning solc
  versions or skipping `--verify` and verifying manually post-deploy.

## Deploying Stable Protection via the wrapper

A wrapper script `contracts/deploy-stable-protection.sh` automates the deploy
with safety rails:

1. Set required env vars in your shell (NOT in any committed file):
   ```bash
   export BASE_RPC_URL=https://mainnet.base.org
   export PRIVATE_KEY=<deployer hex private key, with or without 0x>
   export BASESCAN_API_KEY=<your basescan key>
   export STABLE_PROTECTION_EXPECTED_ADDRESS=<mined address from a dry run>
   ```
   Get the expected address from a dry run first (no `--broadcast`):
   ```bash
   cd contracts && forge script script/DeployStableProtection.s.sol --rpc-url base
   ```

2. Fund the deployer with Base ETH (bridge or transfer ~0.005–0.01 ETH).

3. Run the wrapper from the repo root:
   ```bash
   ./contracts/deploy-stable-protection.sh
   ```

4. The script will:
   - Verify clean git tree, env vars, and deployer balance
   - Display deployment parameters
   - Wait for explicit `yes` confirmation
   - Broadcast the deploy via `forge script --broadcast --verify`
   - Confirm bytecode landed at the expected address
   - Run `npm run verify:hooks` to record the deployment

5. After a successful deploy, follow the checklist above (env var,
   verify:hooks, sign-off doc, README table).

### Why a wrapper instead of running `forge script` directly

- Reduces typo risk on a long forge command
- Adds explicit `yes` prompt before any broadcast
- Verifies the deploy landed at the pre-mined expected address
- Captures the next-steps checklist in the script's output

### What the wrapper does NOT do

- Store, request, or expose your private key (it stays in your shell env)
- Retry on failure (operator decides what to do)
- Run unattended (the `yes` prompt is mandatory)
- Automate via CI/CD (deployment is a manual operation by design)

## Other scripts

- `DeployDynamicMarket.s.sol` — Dynamic Market Hook stack (dedicated
  PoolManager + MarketStateRegistry + mined hook). Runbook:
  `deploy/dynamic-market/README.md`.
- `DeployMarkets.s.sol` — Resolver + MarketFactory against Base USDC.
- `DeployMarketPeriphery.s.sol` — v4 periphery for the dedicated
  dynamic-market PoolManager (pass its address via `POOL_MANAGER`).
- `verify-hooks.ts` — on-chain bytecode/permission verification report
  (`npm run verify:hooks` from the repo root).
