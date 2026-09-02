# Hook integration tests (Phase 5 fork harness)

Foundry-native integration tests that fork **Base Mainnet** (8453) and
exercise each Mantua hook against the canonical
`0x498581fF718922c3f8e6A244956aF099B2652b2b` Uniswap v4 PoolManager.

## Running

```bash
# From repo root.
# Optional: set BASE_RPC_URL in .env for a faster, non-rate-limited
# endpoint. Otherwise the harness falls back to https://mainnet.base.org.
forge test --root contracts --match-path "test/integration/*.t.sol" -vv
```

## Pending-deployment gating

Mantua's hooks have **no Base Mainnet deployment yet** — deploying them
(after security sign-off) is the launch-gating step. The harness
therefore reads hook addresses from env vars instead of checked-in
constants:

| Env var | Hook |
|---|---|
| `STABLE_PROTECTION_HOOK_ADDRESS` | Stable Protection |
| `DYNAMIC_FEE_HOOK_ADDRESS` | Dynamic Fee |

While a var is unset, every test that needs that hook **skips** (via
`_requireHook`). `HookBaseline.t.sol`'s PoolManager check runs
unconditionally — it asserts the canonical v4 PoolManager has bytecode
on the fork. Once a hook is deployed, set its env var and the full
suite runs: `HookBaseline` then also asserts the hook has bytecode at
the configured address and that the lower-14-bit permission flags match
what the hook source declares (the foundry-native counterpart to
`npm run verify:hooks`).

## Suites

| File | Roadmap ID | Covers |
|---|---|---|
| `HookBaseline.t.sol` | P5-001 | Bytecode + permission-flag baseline |
| `StableProtectionE2E.t.sol` | P5-006 | Stable Protection init + swap happy path |
| `DynamicFeeE2E.t.sol` | P5-010 | DynamicFee configure + swap during TWAP warmup |
| `FullLifecycleE2E.t.sol` | P9-002 | create → add → swap (both ways) → remove |

`FullLifecycleE2E.t.sol` walks the entire user-facing v2 flow — pool
create → add liquidity → swap (both directions) → remove liquidity —
against the live Stable Protection hook. Two test cases:

- `test_fullLifecycle_createAddSwapRemove` — single end-to-end pass.
- `test_fullLifecycle_repeatAddSwapRemove` — back-to-back add/swap/remove
  cycles to catch stale-state regressions.

Wired into CI via `.github/workflows/contracts.yml`.

## Conventions

- All integration tests inherit from `BaseFork`, which handles fork
  setup and exposes the env-driven hook addresses + permission-flag
  constants.
- Default fork is `latest` — no pinned block. Pin per-test with
  `vm.createSelectFork(rpc, BLOCK)` in test setUp when you need
  reproducible pool state.
- Tests deploy their own ephemeral mock tokens inside the fork so they
  never touch canonical mainnet pools or balances.
- Use `makeAddr("name")` for synthetic wallets and `vm.deal` /
  `deal()` to fund them — never check in private keys.
