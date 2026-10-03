# Fork integration tests

Foundry-native integration tests that fork **Arc Mainnet** (5042) and
exercise the Dynamic Market stack (Mantua's own PoolManager + hook +
market periphery, deployed by `script/DeployDynamicMarket.s.sol`).

## Running

```bash
# From repo root.
# Optional: set ARC_RPC_URL in .env for a faster, non-rate-limited
# endpoint. Otherwise the harness falls back to https://rpc.mainnet.arc.io.
forge test --root contracts --match-path "test/integration/*.t.sol" -vv
```

## Suites

| File                           | Covers                                                 |
| ------------------------------ | ------------------------------------------------------ |
| `MarketLifecycleForkE2E.t.sol` | bootstrap → trade → resolve → redeem on the live stack |

Wired into CI via `.github/workflows/contracts.yml` as the gating test.

## Conventions

- All integration tests inherit from `ArcFork`, which handles fork
  setup and exposes the env-driven `POOL_MANAGER` address
  (`_requirePoolManager()` skips while it is unset).
- Default fork is `latest` — no pinned block. Pin per-test with
  `vm.createSelectFork(rpc, BLOCK)` in test setUp when you need
  reproducible pool state.
- Tests deploy their own ephemeral mock tokens inside the fork so they
  never touch canonical mainnet pools or balances.
- Use `makeAddr("name")` for synthetic wallets and `vm.deal` /
  `deal()` to fund them — never check in private keys.
