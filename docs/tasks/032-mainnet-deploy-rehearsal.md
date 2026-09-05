# 032 — Mainnet deploy rehearsal on a Base fork (P9-013 de-risk)

**Status:** ✅ rehearsed 2026-09-05 · **Branch:** none (local fork exercise, docs-only record)

## What ran

Full launch-gating deploy chain executed against an Anvil fork of Base
mainnet (block 50,914,524, canonical v4 PoolManager verified present), then
the launch verification script and the fork integration suite against the
resulting deployments.

| Step | Result |
| --- | --- |
| `DeployStableProtection.s.sol` | ✅ hook at `0x9b944…20C0`, CREATE2 salt `0x531b`, permission bits 8384 |
| `DeployMarkets.s.sol` | ✅ Resolver `0x33b02…24b6`, MarketFactory `0x995f6…a7Fa`, collateral = canonical USDC `0x8335…2913` |
| `DeployDynamicMarket.s.sol` | ✅ own PoolManager `0x2cE82…fc7d`, MarketStateRegistry, hook `0xbFB1c…a8C0` (bits 10432, salt `0x96b5`) |
| `DeployMarketPeriphery.s.sol` | ✅ PoolSwapTest, PoolModifyLiquidity, StateView, V4Quoter, PositionDescriptor, PositionManager against the DM PoolManager |
| `verify-hooks.ts` | ✅ both deployed hooks: bytecode present, permission bits match (SP: BEFORE_INITIALIZE/BEFORE_SWAP/AFTER_SWAP; DM: +BEFORE_ADD_LIQUIDITY); DynamicFee correctly ⏳ pending |
| `forge test test/integration/*` | ✅ **5 passed, 0 failed** — incl. `test_fullLifecycle_createAddSwapRemove` and `test_pegHealthy_swapApplied` against the deployed SP hook; 4 skips are DynamicFee-gated (expected) |

Addresses above are fork-run artifacts (CREATE nonce–dependent), NOT the
future mainnet addresses — except the CREATE2-mined hook addresses, which
change with deployer/constructor args anyway. Do not record them anywhere as
real.

## Operational findings for the real deploy (read before launch day)

1. **Foundry simulation quirk**: `forge script --broadcast` failed simulation
   with `lack of funds (0)` against the Anvil fork even with a funded
   broadcaster; `--skip-simulation` executes cleanly. On the real deploy
   (live RPC) simulation should behave; if it recurs, `--skip-simulation`
   is safe *only after* a dry-run (`forge script` without `--broadcast`).
2. **Flags needed together**: `--sender <deployer> --private-key <key>` —
   `DeployMarkets` asserts broadcaster == `MARKET_OPERATOR` pre-broadcast
   (needs `--sender`), and `--sender` then requires the CLI `--private-key`.
3. **Env per script**: SP needs `PRIVATE_KEY`; Markets/DynamicMarket need
   `MARKET_OPERATOR` + `MARKET_RESOLVER`; Periphery needs `POOL_MANAGER`
   (the DynamicMarket one, not canonical).
4. **Benign remapping warning**: `solmate/src/src/auth/Owned.sol: No such
   file` prints every run from a doubled remapping; compilation succeeds.
   Cosmetic follow-up in `remappings.txt`.
5. **DynamicFee gap**: no deploy script in this repo — it lives in the
   `dynamic-fee` hook repo. Launch-gating if DynamicFee ships at launch;
   per D-002 it is v2.1, so not blocking.
6. Real-deploy postscript per script READMEs: BaseScan verification, then
   set `STABLE_PROTECTION_HOOK_ADDRESS` / `DYNAMIC_MARKET_HOOK_ADDRESS` /
   markets addresses in server env and re-run `verify-hooks.ts` + this
   fork suite against the live chain.

## What this de-risks

P9-013's mechanical risk is now retired: every deploy script compiles,
mines, broadcasts, and produces contracts that pass the launch verification
and the full-lifecycle integration test on a mainnet-state fork. The
remaining launch-day variables are operator-side only: a funded deployer
key, gas, BaseScan verification, and env wiring.
